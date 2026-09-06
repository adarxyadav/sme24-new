import { screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { roundChf } from "@/features/benchmark/model";
import { BenchmarkSegment, confidenceDriver } from "@/features/benchmark/ui/benchmark-segment";
import { formats, TIME_ZONE } from "@/i18n/formats";
import {
  assumptionRow,
  catalogue,
  company,
  en,
  enFormat,
  gap,
  inputKpi,
  parsedSnapshot,
  peer,
  renderEnglish,
  result,
} from "./helpers";

/**
 * The benchmark segment (spec 0008, AC-9, AC-14): the three waiting states, the opportunity
 * card with the rounded cost in `chfWhole`, the range, both savings, the confidence badge with
 * the KPI that drove it, the computed on date and the provisional note; the card naming the
 * missing input with the facts form when no cost exists; the top three gaps with the rest
 * behind a disclosure and the positive empty state; one position row per catalogue KPI with the
 * band, the quartiles, the peer label, "no value" and "no peer data yet". The server translator
 * and formatter, the disclosure body, the server action and the router are the boundaries.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en-CH", messages: en, namespace: namespace as never, formats }),
  getFormatter: async () => createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE }),
}));
vi.mock("@/features/benchmark/ui/calculation-content", () => ({
  CalculationContent: () => <p data-testid="calculation-content">calculation body</p>,
}));
vi.mock("@/features/benchmark/actions", () => ({ updateCompanyFacts: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/app",
  useSearchParams: () => new URLSearchParams(),
}));

const b = en.benchmark;
// The formatter separates CHF from the number with a non breaking space; the DOM matchers collapse it.
const chf = (value: number) => enFormat.number(roundChf(value), "chfWhole").replace(/\s/g, " ");
const assumptions = [assumptionRow("direct_cost_per_case_chf")];

async function renderSegment(overrides: Partial<Parameters<typeof BenchmarkSegment>[0]> = {}) {
  const element = await BenchmarkSegment({
    snapshot: parsedSnapshot(),
    state: "ready",
    catalogue,
    assumptions,
    company,
    locale: "en",
    ...overrides,
  });
  return renderEnglish(element);
}

const section = () => screen.getByRole("region", { name: b.heading });

describe("the waiting states (AC-9)", () => {
  it("shows the calculating text with a live region and a skeleton, and nothing else", async () => {
    const { container } = await renderSegment({ snapshot: null, state: "calculating" });
    expect(section()).toHaveAttribute("data-benchmark-state", "calculating");
    expect(screen.getByText(b.state.calculating)).toHaveAttribute("aria-live", "polite");
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    expect(container.querySelector("[data-opportunity-card]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-facts-form]")).not.toBeInTheDocument();
  });

  it("says the benchmark is not available yet, without a form", async () => {
    const { container } = await renderSegment({ snapshot: null, state: "unavailable" });
    expect(screen.getByText(b.state.unavailable)).toBeInTheDocument();
    expect(container.querySelector("[data-facts-form]")).not.toBeInTheDocument();
  });

  it("says there is not enough data and offers the facts form to correct the inputs", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ kpisCompared: 0 }),
      state: "noData",
    });
    expect(screen.getByText(b.state.noData)).toBeInTheDocument();
    expect(screen.getByText(b.disclosure.correctTitle)).toBeInTheDocument();
    expect(container.querySelector("[data-facts-form]")).toBeInTheDocument();
    expect(container.querySelector("[data-opportunity-card]")).not.toBeInTheDocument();
  });
});

describe("the opportunity card (AC-9, AC-14)", () => {
  it("shows the rounded cost headline, the range, both savings, the confidence and the date", async () => {
    const { container } = await renderSegment();
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(within(card).getByText(b.card.title)).toBeInTheDocument();
    expect(card.querySelector("[data-cost-headline]")).toHaveTextContent(chf(1_961_340));
    expect(
      within(card).getByText(`Range ${chf(1_060_180)} to ${chf(2_650_450)}`),
    ).toBeInTheDocument();
    expect(card.querySelector("[data-saving-median]")).toHaveTextContent(chf(522_340));
    expect(card.querySelector("[data-saving-top]")).toHaveTextContent(chf(955_340));
    expect(
      within(card).getByText("Confidence from accident_rate_per_1000_fte (en)"),
    ).toBeInTheDocument();
    expect(card.querySelector("[data-computed-on]")).toHaveTextContent("Computed on 06.09.2026");
    expect(within(card).getByText("5 of 8 KPIs compared")).toBeInTheDocument();
  });

  it("rounds a cost below 10 000 to the nearest 100", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ costChf: 8_449, costLowChf: 4_120, costHighChf: 11_990 }),
    });
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(card.querySelector("[data-cost-headline]")).toHaveTextContent(chf(8_400));
    expect(card.querySelector("[data-cost-headline]")).toHaveTextContent(/8.400/);
  });

  it("names the confidence level with the three feature 8 levels", async () => {
    const { container } = await renderSegment();
    const badge = container.querySelector("[data-opportunity-card] [data-confidence]");
    expect(badge).toHaveAttribute("data-confidence", "high");
    expect(badge).toHaveTextContent("High");
  });

  it("says no peer reference for a saving the model could not compute", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ savingMedianChf: null, savingTopChf: null }),
    });
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(card.querySelector("[data-saving-median]")).toHaveTextContent(b.card.noReference);
    expect(card.querySelector("[data-saving-top]")).toHaveTextContent(b.card.noReference);
  });

  it("shows the provisional note while the peers are provisional and hides it once they are final", async () => {
    const { container, unmount } = await renderSegment();
    expect(container.querySelector("[data-provisional-note]")).toHaveTextContent(b.provisionalNote);
    unmount();
    const final = await renderSegment({ snapshot: parsedSnapshot({ peerProvisional: false }) });
    expect(final.container.querySelector("[data-provisional-note]")).not.toBeInTheDocument();
  });

  it("names the missing headcount and shows the facts form when the cost is null without an FTE", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {
          costChf: null,
          costLowChf: null,
          costHighChf: null,
          savingMedianChf: null,
          savingTopChf: null,
        },
        { cost: null, inputs: { ...parsedSnapshot().blocks.inputs, fte: null } },
      ),
    });
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(within(card).getByText(b.card.missingHeadcount)).toBeInTheDocument();
    expect(card.querySelector("[data-facts-form]")).toBeInTheDocument();
    expect(card.querySelector("[data-cost-headline]")).not.toBeInTheDocument();
    expect(card.querySelector("[data-computed-on]")).toHaveTextContent("Computed on 06.09.2026");
  });

  it("names the missing incident rate when the headcount is known but no cost exists", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ costChf: null }, { cost: null }),
    });
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(within(card).getByText(b.card.missingIncidentRate)).toBeInTheDocument();
    expect(card.querySelector("[data-facts-form]")).toBeInTheDocument();
  });

  it("puts the calculation disclosure under the card, closed, with the correct facts form inside", async () => {
    const { container } = await renderSegment();
    const trigger = screen.getByRole("button", { name: b.disclosure.title });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("calculation-content")).not.toBeInTheDocument();
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(card.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("the priority gaps (AC-9)", () => {
  it("lists the top three gaps in rank order with the rest behind a show all disclosure", async () => {
    const { container } = await renderSegment();
    const gaps = screen.getByRole("region", { name: b.gaps.title });
    expect(gaps).toHaveAttribute("data-gaps", "4");
    const [top, rest] = Array.from(gaps.querySelectorAll("ol"));
    const topKeys = Array.from((top as HTMLElement).querySelectorAll("[data-gap]")).map((item) =>
      item.getAttribute("data-gap"),
    );
    expect(topKeys).toEqual(["fatalities", "accident_rate_per_1000_fte", "lost_days_per_incident"]);
    expect(within(gaps).getByText("Show all gaps (4)")).toBeInTheDocument();
    expect(rest?.querySelector('[data-gap="absenteeism_rate"]')).toHaveAttribute("data-rank", "4");
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });

  it("shows the value against the median, the relative gap and the CHF saving of a cost linked gap", async () => {
    const { container } = await renderSegment();
    const rate = container.querySelector('[data-gap="accident_rate_per_1000_fte"]') as HTMLElement;
    expect(within(rate).getByText("Rank 2")).toBeInTheDocument();
    expect(within(rate).getByText("68.00 vs. median 49.90")).toBeInTheDocument();
    expect(within(rate).getByText(/^36\.3\s?% above the median$/)).toBeInTheDocument();
    expect(rate.querySelector("[data-gap-saving]")).toHaveTextContent(
      `${chf(522_340)} per year at the median`,
    );
  });

  it("puts a fatality first with its own sentence and no numbers", async () => {
    const { container } = await renderSegment();
    const fatality = container.querySelector('[data-gap="fatalities"]') as HTMLElement;
    expect(fatality).toHaveAttribute("data-rank", "1");
    expect(within(fatality).getByText(b.gaps.fatality)).toBeInTheDocument();
    expect(within(fatality).queryByText(/above the median/)).not.toBeInTheDocument();
    expect(fatality.querySelector("[data-gap-saving]")).not.toBeInTheDocument();
  });

  it("formats a percent KPI gap from its fraction", async () => {
    const { container } = await renderSegment();
    const absent = container.querySelector('[data-gap="absenteeism_rate"]') as HTMLElement;
    expect(within(absent).getByText(/^3\.8\s?% vs\. median 3\.5\s?%$/)).toBeInTheDocument();
    expect(within(absent).getByText(/^8\.6\s?% above the median$/)).toBeInTheDocument();
  });

  it("shows no disclosure when three or fewer gaps exist", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {},
        { gaps: [gap(1, "accident_rate_per_1000_fte", { gapRelative: 0.363 })] },
      ),
    });
    expect(container.querySelector("details")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-gap]")).toHaveLength(1);
  });

  it("renders the positive empty state when no gap exists", async () => {
    const { container } = await renderSegment({ snapshot: parsedSnapshot({}, { gaps: [] }) });
    expect(screen.getByText(b.gaps.empty)).toBeInTheDocument();
    expect(container.querySelectorAll("[data-gap]")).toHaveLength(0);
  });
});

describe("the positions (AC-9, AC-14)", () => {
  it("renders one row per active catalogue KPI in sort order", async () => {
    const { container } = await renderSegment();
    const keys = Array.from(container.querySelectorAll("[data-position-kpi]")).map((row) =>
      row.getAttribute("data-position-kpi"),
    );
    expect(keys).toEqual(catalogue.map((definition) => definition.key));
  });

  it("shows the value, the band, the quartiles, the sample and the band drawing for a compared KPI", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector(
      '[data-position-kpi="accident_rate_per_1000_fte"]',
    ) as HTMLElement;
    expect(row).toHaveAttribute("data-position", "bottom_quarter");
    expect(within(row).getByText("68.00")).toBeInTheDocument();
    expect(within(row).getByText(b.positions.band.bottom_quarter)).toBeInTheDocument();
    expect(within(row).getByText("p25 34.90 · median 49.90 · p75 66.40")).toBeInTheDocument();
    expect(
      within(row).getByText("Manufacturing · 250 and more employees · 2022, n = 120"),
    ).toBeInTheDocument();
    expect(row.querySelector('[data-slot="quartile-band"] svg')).toHaveAttribute(
      "data-value",
      "68",
    );
    expect(
      within(row).getByText(
        "accident_rate_per_1000_fte (en): your value 68.00 is in the band Bottom quarter. Peer quartiles: p25 34.90, median 49.90, p75 66.40.",
      ),
    ).toHaveClass("sr-only");
  });

  it("names a coarser rung as all industries and all sizes with the nearest year, and no sample", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector('[data-position-kpi="ltifr"]') as HTMLElement;
    expect(
      within(row).getByText("all industries · all sizes · 2021 (nearest year)"),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/n = /)).not.toBeInTheDocument();
  });

  it("formats the certified share as a percentage and draws no band for a yes or no KPI", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector('[data-position-kpi="iso_45001_certified"]') as HTMLElement;
    expect(within(row).getByText("Yes")).toBeInTheDocument();
    expect(within(row).getByText(/^p25 30\s?% · median 30\s?% · p75 30\s?%$/)).toBeInTheDocument();
    expect(row.querySelector('[data-slot="quartile-band"]')).not.toBeInTheDocument();
  });

  it("divides an absenteeism value and its quartiles by 100 before the percent format", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector('[data-position-kpi="absenteeism_rate"]') as HTMLElement;
    expect(within(row).getByText(/^3\.8\s?%$/)).toBeInTheDocument();
    expect(
      within(row).getByText(/^p25 2\.5\s?% · median 3\.5\s?% · p75 4\.5\s?%$/),
    ).toBeInTheDocument();
  });

  it("says no value for a KPI without a row and no peer data yet for one without a peer", async () => {
    const { container } = await renderSegment();
    const nearMiss = container.querySelector('[data-position-kpi="near_miss_rate"]') as HTMLElement;
    expect(within(nearMiss).getByText(b.positions.noValue)).toBeInTheDocument();
    expect(within(nearMiss).queryByText(b.positions.noPeer)).not.toBeInTheDocument();
    const trifr = container.querySelector('[data-position-kpi="trifr"]') as HTMLElement;
    expect(within(trifr).getByText("6.10")).toBeInTheDocument();
    expect(within(trifr).getByText(b.positions.noPeer)).toBeInTheDocument();
    expect(trifr).toHaveAttribute("data-position", "");
  });
});

describe("confidenceDriver (AC-9)", () => {
  it("names the cost KPI whose confidence equals the snapshot's", () => {
    expect(confidenceDriver(parsedSnapshot())).toBe("accident_rate_per_1000_fte");
  });

  it("names the lost days row when it drove the count and the cost read the KPI", () => {
    const snapshot = parsedSnapshot(
      { confidence: 0.6 },
      {
        inputs: {
          ...parsedSnapshot().blocks.inputs,
          kpis: [
            inputKpi("accident_rate_per_1000_fte", 68, { confidence: 0.9 }),
            inputKpi("lost_days_per_incident", 12.5, { confidence: 0.6 }),
          ],
        },
      },
    );
    expect(confidenceDriver(snapshot)).toBe("lost_days_per_incident");
  });

  it("ignores the lost days row when the cost used the default assumption", () => {
    const base = parsedSnapshot();
    const snapshot = parsedSnapshot(
      { confidence: 0.6 },
      {
        cost: {
          ...(base.blocks.cost as NonNullable<typeof base.blocks.cost>),
          lostDaysSource: "default",
        },
        inputs: {
          ...base.blocks.inputs,
          kpis: [
            inputKpi("accident_rate_per_1000_fte", 68, { confidence: 0.9 }),
            inputKpi("lost_days_per_incident", 12.5, { confidence: 0.6 }),
          ],
        },
      },
    );
    expect(confidenceDriver(snapshot)).toBeNull();
  });

  it("is null without a cost or without a confidence", () => {
    expect(confidenceDriver(parsedSnapshot({}, { cost: null }))).toBeNull();
    expect(confidenceDriver(parsedSnapshot({ confidence: null }))).toBeNull();
    expect(
      confidenceDriver(
        parsedSnapshot({}, { results: [result("ltifr", { peer: peer([1, 2, 4]) })] }),
      ),
    ).toBe("accident_rate_per_1000_fte");
  });
});
