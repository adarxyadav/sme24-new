import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { roundChf } from "@/features/benchmark/model";
import { BenchmarkSegment, confidenceDriver } from "@/features/benchmark/ui/benchmark-segment";
import { formats, TIME_ZONE } from "@/i18n/formats";
import {
  assumptionRow,
  catalogue,
  company,
  derivedBlock,
  derivedCount,
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

  it("renders the caller's figures slot above the facts form in noData (spec 0010)", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ kpisCompared: 0 }),
      state: "noData",
      figuresSlot: <div data-test-figures>Your figures</div>,
    });
    const slot = container.querySelector("[data-test-figures]");
    const form = container.querySelector("[data-facts-form]");
    expect(slot).toBeInTheDocument();
    expect(form).toBeInTheDocument();
    // The figures come first: entering a KPI is the fix the alert asks for, correcting the
    // industry is the fallback.
    expect(slot?.compareDocumentPosition(form as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("withholds the figures slot from a read only reader (spec 0013, AC-11)", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ kpisCompared: 0 }),
      state: "noData",
      readOnly: true,
      figuresSlot: <div data-test-figures>Your figures</div>,
    });
    expect(screen.getByText(b.state.noData)).toBeInTheDocument();
    expect(container.querySelector("[data-test-figures]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-facts-form]")).not.toBeInTheDocument();
  });

  it("renders noData unchanged when the caller passes no slot", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ kpisCompared: 0 }),
      state: "noData",
    });
    expect(container.querySelector("[data-test-figures]")).not.toBeInTheDocument();
    expect(container.querySelector("[data-facts-form]")).toBeInTheDocument();
  });
});

describe("the opportunity card (AC-9, AC-14)", () => {
  // The range leads and the working estimate sits beneath it (spec 0016, AC-9). The ends round
  // outward, so 1 060 180 floors to 1 060 000 and 2 650 450 ceils to 2 651 000: the displayed band
  // always contains the computed one.
  it("leads with the outward rounded range, then the working estimate, both savings, the confidence and the date", async () => {
    const { container } = await renderSegment();
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(within(card).getByText(b.card.title)).toBeInTheDocument();
    const range = card.querySelector("[data-cost-range]") as HTMLElement;
    expect(range).toHaveTextContent(`${chf(1_060_000)} to ${chf(2_651_000)}`);
    expect(range).toHaveAttribute("data-cost-low", "1060000");
    expect(range).toHaveAttribute("data-cost-high", "2651000");
    expect(card.querySelector("[data-cost-headline]")).toHaveTextContent(
      `Working estimate ${chf(1_961_340)}`,
    );
    expect(card.querySelector("[data-saving-median]")).toHaveTextContent(chf(522_340));
    expect(card.querySelector("[data-saving-top]")).toHaveTextContent(chf(955_340));
    expect(
      within(card).getByText("Confidence from accident_rate_per_1000_fte (en)"),
    ).toBeInTheDocument();
    expect(card.querySelector("[data-computed-on]")).toHaveTextContent("Computed on 06.09.2026");
    expect(within(card).getByText("5 of 8 KPIs compared")).toBeInTheDocument();
  });

  it("rounds a cost below 10 000 to the nearest 100, and each range end at its own step", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ costChf: 8_449, costLowChf: 4_120, costHighChf: 11_990 }),
    });
    const card = container.querySelector("[data-opportunity-card]") as HTMLElement;
    expect(card.querySelector("[data-cost-headline]")).toHaveTextContent(chf(8_400));
    expect(card.querySelector("[data-cost-headline]")).toHaveTextContent(/8.400/);
    // The two ends straddle the 10 000 boundary, so they round at different steps: 4 120 floors
    // to 4 100 at the nearest 100, 11 990 ceils to 12 000 at the nearest 1 000 (spec 0016, AC-9).
    const range = card.querySelector("[data-cost-range]") as HTMLElement;
    expect(range).toHaveAttribute("data-cost-low", "4100");
    expect(range).toHaveAttribute("data-cost-high", "12000");
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

  /**
   * The `ready` state with a null cost renders the facts form twice: the opportunity card shows
   * one beside the missing input warning, and the opened disclosure shows another. Both must keep
   * their own ids, or the labels and the `aria-describedby` hints resolve to the wrong form. The
   * e2e spec only walks the cost present path, so axe never sees this page there.
   */
  it("keeps the two facts forms free of duplicate ids and axe violations when the cost is null", async () => {
    const { container } = await renderSegment({
      snapshot: parsedSnapshot({ costChf: null }, { cost: null }),
    });
    await userEvent.click(screen.getByRole("button", { name: b.disclosure.title }));
    const forms = container.querySelectorAll("[data-facts-form]");
    expect(forms).toHaveLength(2);

    const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
    expect(ids.length).toBe(new Set(ids).size);

    // Each form's label and hint point at a control inside that same form, not the other one.
    for (const form of forms) {
      for (const label of form.querySelectorAll("label[for]")) {
        const target = container.querySelector(`#${CSS.escape(label.getAttribute("for") ?? "")}`);
        expect(form.contains(target)).toBe(true);
      }
      const employees = form.querySelector("input[type='number']") as HTMLElement;
      const describedBy = employees.getAttribute("aria-describedby") ?? "";
      expect(form.contains(container.querySelector(`#${CSS.escape(describedBy)}`))).toBe(true);
    }

    const results = await axe.run(container, {
      runOnly: ["cat.forms", "cat.aria", "cat.name-role-value", "cat.color"],
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
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

describe("the derived injury counts (spec 0012)", () => {
  const withDerived = (derived = derivedBlock()) => ({
    snapshot: parsedSnapshot({}, { derived }),
  });

  it("shows both counts above the CHF figure, each with a Calculated badge (AC-1, AC-2)", async () => {
    const { container } = await renderSegment(withDerived());
    const block = container.querySelector("[data-derived-block]") as HTMLElement;
    expect(block).toBeInTheDocument();
    // Lost time first, so the number that drives the CHF figure sits nearest to it.
    const values = [...container.querySelectorAll("[data-derived-count]")].map((node) =>
      node.getAttribute("data-derived-count"),
    );
    expect(values).toEqual(["lost-time", "recordable"]);
    const headline = container.querySelector("[data-cost-headline]") as HTMLElement;
    expect(block.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(block).getAllByText(b.derived.calculated)).toHaveLength(2);
  });

  it("shows one decimal, so a fraction of an injury never reads as none (AC-8)", async () => {
    const { container } = await renderSegment(
      withDerived(derivedBlock({ lostTime: derivedCount({ count: 0.42 }) })),
    );
    const lostTime = container.querySelector('[data-derived-count="lost-time"]') as HTMLElement;
    expect(within(lostTime).getByText("0.4")).toBeInTheDocument();
  });

  it("names the figure and year, following the source of the row (AC-4)", async () => {
    const { container } = await renderSegment(
      withDerived(
        derivedBlock({ lostTime: derivedCount({ fromSource: "client", fromYear: 2024 }) }),
      ),
    );
    const lostTime = container.querySelector('[data-derived-count="lost-time"]') as HTMLElement;
    // The KPI name comes from the catalogue in the reader's language, not a hardcoded label.
    // The fixture names are "ltifr (en)" / "trifr (en)", so the gloss is dropped here too.
    expect(lostTime).toHaveTextContent("Calculated from your ltifr for 2024");
    const recordable = container.querySelector('[data-derived-count="recordable"]') as HTMLElement;
    expect(recordable).toHaveTextContent("Calculated from the researched trifr for 2025");
  });

  it("drops the catalogue name's parenthetical gloss inside the sentence (AC-4)", async () => {
    const withGloss = catalogue.map((entry) =>
      entry.key === "ltifr"
        ? {
            ...entry,
            name: {
              de: "LTIFR (Unfälle mit Ausfallzeit)",
              en: "LTIFR (lost time injury frequency rate)",
            },
          }
        : entry,
    );
    const { container } = await renderSegment({ ...withDerived(), catalogue: withGloss });
    const lostTime = container.querySelector('[data-derived-count="lost-time"]') as HTMLElement;
    expect(lostTime).toHaveTextContent("Calculated from the researched LTIFR for 2025");
    expect(lostTime).not.toHaveTextContent("lost time injury frequency rate");
  });

  it("uses the short Suva phrase rather than the catalogue name (AC-4)", async () => {
    const { container } = await renderSegment(
      withDerived(
        derivedBlock({
          lostTime: derivedCount({
            count: 28.56,
            fromKey: "accident_rate_per_1000_fte",
            fromValue: 68,
            fromYear: 2024,
          }),
        }),
      ),
    );
    const lostTime = container.querySelector('[data-derived-count="lost-time"]') as HTMLElement;
    expect(lostTime).toHaveTextContent(
      "Calculated from the researched Suva accident rate for 2024",
    );
  });

  it("carries no confidence score anywhere on the block (AC-5)", async () => {
    const { container } = await renderSegment(withDerived());
    const block = container.querySelector("[data-derived-block]") as HTMLElement;
    expect(block.querySelector("[data-confidence]")).not.toBeInTheDocument();
  });

  it("drops only the missing count and keeps the other showing (AC-6)", async () => {
    const { container } = await renderSegment(withDerived(derivedBlock({ recordable: null })));
    expect(container.querySelector('[data-derived-count="lost-time"]')).toBeInTheDocument();
    expect(container.querySelector('[data-derived-count="recordable"]')).not.toBeInTheDocument();
  });

  it("renders no block at all on a stored version 1 snapshot (AC-7, AC-12)", async () => {
    const { container } = await renderSegment();
    expect(container.querySelector("[data-derived-block]")).not.toBeInTheDocument();
    // Everything the card showed before this block existed is still there.
    expect(container.querySelector("[data-cost-headline]")).toBeInTheDocument();
    expect(container.querySelector("[data-saving-median]")).toBeInTheDocument();
  });

  it("states the exposure from the block rather than recomputing it", async () => {
    const { container } = await renderSegment(withDerived());
    const exposure = container.querySelector("[data-derived-exposure]") as HTMLElement;
    expect(exposure).toHaveTextContent("420");
    expect(exposure).toHaveTextContent(/1.800/);
  });

  it("passes axe with the block on the card (AC-14)", async () => {
    const { container } = await renderSegment(withDerived());
    const results = await axe.run(container, {
      runOnly: ["cat.forms", "cat.aria", "cat.name-role-value", "cat.color"],
    });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
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

  // A rung 3 or 4 match means the company's own section had no row, and the shape can flip on that
  // fallback, so the label says the group was broadened rather than naming it as if it were the
  // company's own sector (spec 0016, AC-6b).
  it("says the peer group was broadened on a coarser rung, with the nearest year and no sample", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector('[data-position-kpi="ltifr"]') as HTMLElement;
    expect(
      within(row).getByText(`${b.positions.broadened} · all sizes · 2021 (nearest year)`),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/n = /)).not.toBeInTheDocument();
  });

  // The certified share is one figure repeated as all three quartiles, so it is a point row: one
  // labelled sector figure, no band, and none of the words quarter, quartile or median on the row
  // (spec 0016, AC-6).
  it("renders the certified share as a point comparison with no band and no quartile wording", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector('[data-position-kpi="iso_45001_certified"]') as HTMLElement;
    expect(within(row).getByText("Yes")).toBeInTheDocument();
    expect(row).toHaveAttribute("data-peer-shape", "point");
    expect(row.querySelector("[data-sector-figure]")).toHaveAttribute("data-sector-figure", "0.3");
    expect(within(row).getByText(b.positions.pointBasis)).toBeInTheDocument();
    expect(row.querySelector('[data-slot="quartile-band"]')).not.toBeInTheDocument();
    expect(row.textContent).not.toMatch(/quarter|quartile|median|p25|p75/i);
  });

  it("divides an absenteeism value and its quartiles by 100 before the percent format", async () => {
    const { container } = await renderSegment();
    const row = container.querySelector('[data-position-kpi="absenteeism_rate"]') as HTMLElement;
    expect(within(row).getByText(/^3\.8\s?%$/)).toBeInTheDocument();
    expect(
      within(row).getByText(/^p25 2\.5\s?% · median 3\.5\s?% · p75 4\.5\s?%$/),
    ).toBeInTheDocument();
  });

  // A KPI nobody publishes must say so rather than showing the shared "not yet", which would have
  // the client waiting for data that is never coming (spec 0016, AC-7, AC-8). Near misses are the
  // one KPI no body anywhere collects; fatalities moved to `pending` under the 2026-09-12
  // amendment once Eurostat's sector rate was found.
  it("gives a sourceless KPI its own title and sentence rather than the shared not yet", async () => {
    // The fixture has no near miss value, so give it one with no peer row for this case.
    const base = parsedSnapshot().blocks;
    const { container } = await renderSegment({
      snapshot: parsedSnapshot(
        {},
        {
          inputs: { ...base.inputs, kpis: [...base.inputs.kpis, inputKpi("near_miss_rate", 14)] },
          results: [...base.results, result("near_miss_rate")],
        },
      ),
    });
    const nearMiss = container.querySelector(
      '[data-position-kpi="near_miss_rate"] [data-no-peer]',
    ) as HTMLElement;
    expect(within(nearMiss).getByText(b.positions.peerStatus.noSourceTitle)).toBeInTheDocument();
    expect(nearMiss).toHaveTextContent(b.positions.peerNote.near_miss_rate);
    expect(nearMiss).not.toHaveTextContent(b.positions.peerStatus.pendingTitle);
    expect(nearMiss.querySelector('[data-peer-status="no_source"]')).toBeInTheDocument();
  });

  // A `pending` KPI is readable but not read yet, so it keeps a "not yet" wording that names what
  // is awaited (AC-8). The two states must not collapse into one another.
  it("keeps a not yet wording for a pending KPI and names what is awaited", async () => {
    const { container } = await renderSegment();
    const trifr = container.querySelector(
      '[data-position-kpi="trifr"] [data-no-peer]',
    ) as HTMLElement;
    // Asserted against `pendingTitle`, not the generic `noPeer`: the two strings are byte
    // identical in both catalogs today, so matching on `noPeer` would pass even if the pending
    // branch were deleted. This pins the branch, so the wording can be sharpened during curation.
    expect(within(trifr).getByText(b.positions.peerStatus.pendingTitle)).toBeInTheDocument();
    expect(trifr).toHaveTextContent(b.positions.peerNote.trifr);
    expect(trifr).not.toHaveTextContent(b.positions.peerStatus.noSourceTitle);
    expect(trifr.querySelector('[data-peer-status="pending"]')).toBeInTheDocument();
  });

  it("says no value for a KPI without a row and no peer data yet for one without a peer", async () => {
    const { container } = await renderSegment();
    const nearMiss = container.querySelector('[data-position-kpi="near_miss_rate"]') as HTMLElement;
    expect(within(nearMiss).getByText(b.positions.noValue)).toBeInTheDocument();
    expect(within(nearMiss).queryByText(b.positions.noPeer)).not.toBeInTheDocument();
    const trifr = container.querySelector('[data-position-kpi="trifr"]') as HTMLElement;
    expect(within(trifr).getByText("6.10")).toBeInTheDocument();
    // `trifr` is a pending KPI, so the title it renders is `pendingTitle`; `noPeer` would match
    // only because the two strings are identical today (spec 0016, AC-8).
    expect(within(trifr).getByText(b.positions.peerStatus.pendingTitle)).toBeInTheDocument();
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
