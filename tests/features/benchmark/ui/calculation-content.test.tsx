import { screen, within } from "@testing-library/react";
import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { CalculationContent } from "@/features/benchmark/ui/calculation-content";
import { formats, TIME_ZONE } from "@/i18n/formats";
import {
  assumptionRow,
  assumptionUsed,
  catalogue,
  en,
  inputKpi,
  parsedSnapshot,
  peer,
  renderEnglish,
  result,
} from "./helpers";

/**
 * The body of "How this is calculated" (spec 0008, AC-10): the formula and the FTE line in the
 * reader's language, each assumption the snapshot used with its value, unit, source (a link
 * when a URL is stored), provisional mark and effective date, the inputs used per KPI with the
 * source kind and the peer rung, the headcount and the industry. Everything comes from the
 * snapshot blocks; the labels from the assumption rows and the catalogue. The server translator
 * and formatter are the boundary.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en-CH", messages: en, namespace: namespace as never, formats }),
  getFormatter: async () => createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE }),
}));

const d = en.benchmark.disclosure;
const assumptions = [
  assumptionRow("direct_cost_per_case_chf", { unit: "CHF per case" }),
  assumptionRow("cost_per_absence_day_chf", { unit: "CHF per day" }),
  assumptionRow("indirect_multiplier"),
];

async function renderContent(overrides: Partial<Parameters<typeof parsedSnapshot>[1]> = {}) {
  const element = await CalculationContent({
    snapshot: parsedSnapshot({}, overrides),
    catalogue,
    assumptions,
    locale: "en",
  });
  return renderEnglish(element);
}

describe("CalculationContent (AC-10)", () => {
  it("states the formula in words and the fixed full time equivalent line", async () => {
    await renderContent();
    expect(screen.getByText(d.formula)).toBeInTheDocument();
    expect(screen.getByText(d.fteLine)).toBeInTheDocument();
  });

  it("lists every assumption used with its label, value, unit, source and effective date", async () => {
    const { container } = await renderContent();
    const section = container.querySelector("[data-assumptions]") as HTMLElement;
    expect(section).toHaveAttribute("data-assumptions", "3");
    const items = within(section).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const direct = items[0] as HTMLElement;
    expect(direct).toHaveAttribute("data-assumption", "direct_cost_per_case_chf");
    expect(within(direct).getByText("direct_cost_per_case_chf (en)")).toBeInTheDocument();
    expect(within(direct).getByText(/^4.811 CHF per case$/)).toBeInTheDocument();
    expect(within(direct).getByText(/as of 31\.12\.2022/)).toBeInTheDocument();
  });

  it("links the source when a URL is stored and shows plain text otherwise", async () => {
    const { container } = await renderContent();
    const items = container.querySelectorAll("[data-assumption]");
    const linked = within(items[0] as HTMLElement).getByRole("link", { name: /Suva statistics/ });
    expect(linked).toHaveAttribute("href", "https://www.suva.ch/statistik");
    expect(linked).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(items[1] as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText(/Suva statistics/)).toBeInTheDocument();
  });

  it("marks a provisional assumption and leaves a final one unmarked", async () => {
    const { container } = await renderContent();
    const items = container.querySelectorAll("[data-assumption]");
    expect(within(items[0] as HTMLElement).getByText(d.provisional)).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByText(d.provisional)).not.toBeInTheDocument();
  });

  it("falls back to the key when no assumption row carries a label", async () => {
    const element = await CalculationContent({
      snapshot: parsedSnapshot(),
      catalogue,
      assumptions: [],
      locale: "en",
    });
    renderEnglish(element);
    expect(screen.getByText("direct_cost_per_case_chf")).toBeInTheDocument();
  });

  it("says no assumption was used when the snapshot computed no cost", async () => {
    const { container } = await renderContent({ assumptions: [], cost: null });
    expect(screen.getByText(d.noCost)).toBeInTheDocument();
    expect(container.querySelector("[data-assumptions]")).toHaveAttribute("data-assumptions", "0");
  });

  it("lists the headcount, the division with its section and band, and one line per KPI input", async () => {
    const { container } = await renderContent();
    expect(screen.getByText("Headcount: 420")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Industry: 23 · Manufacture of other non metallic mineral products (section C), size band 250 and more employees",
      ),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("[data-input-kpi]")).toHaveLength(7);
  });

  it("names the value, year, source kind and the peer rung per KPI, and the missing peer row", async () => {
    const { container } = await renderContent();
    const rate = container.querySelector(
      '[data-input-kpi="accident_rate_per_1000_fte"]',
    ) as HTMLElement;
    expect(rate).toHaveTextContent(
      "accident_rate_per_1000_fte (en): 68.00 (2025, from the research)",
    );
    expect(rate).toHaveTextContent("peer: Manufacturing · 250 and more employees · 2022");
    const lostDays = container.querySelector(
      '[data-input-kpi="lost_days_per_incident"]',
    ) as HTMLElement;
    expect(lostDays).toHaveTextContent("12.50 (2025, entered by you)");
    expect(lostDays).toHaveTextContent("peer: all industries · 250 and more employees · 2022");
    const ltifr = container.querySelector('[data-input-kpi="ltifr"]') as HTMLElement;
    expect(ltifr).toHaveTextContent("peer: all industries · all sizes · 2021");
    expect(container.querySelector('[data-input-kpi="trifr"]')).toHaveTextContent(d.noPeerUsed);
  });

  it("formats a percent KPI from its fraction and a yes or no KPI in words", async () => {
    const { container } = await renderContent();
    expect(container.querySelector('[data-input-kpi="absenteeism_rate"]')).toHaveTextContent(
      /3\.8\s?% \(2025/,
    );
    expect(container.querySelector('[data-input-kpi="iso_45001_certified"]')).toHaveTextContent(
      "Yes (2025",
    );
  });

  // Spec 0016 splits two flags that used to look alike in the disclosure. `provisional` means the
  // value has not been read from its source yet; `is_assumption` means no published source exists
  // at all, so waiting for it is pointless. They are never both true on one row, and the badge the
  // reader sees must follow the flag rather than treating all seven constants alike (AC-10).
  describe("a declared assumption (spec 0016, AC-10)", () => {
    const multiplier = assumptionUsed("indirect_multiplier", 3.7, {
      unit: "factor",
      provisional: false,
      isAssumption: true,
      note: {
        de: "Arbeitswert in der Mitte der Bandbreite.",
        en: "SME24's own estimate rather than a published Swiss figure.",
      },
    });

    it("badges a declared assumption and renders its note naming the source", async () => {
      const { container } = await renderContent({ assumptions: [multiplier] });
      const item = container.querySelector(
        '[data-assumption="indirect_multiplier"]',
      ) as HTMLElement;
      expect(within(item).getByText(d.declaredAssumption)).toBeInTheDocument();
      expect(item.querySelector("[data-assumption-note]")).toHaveTextContent(
        "SME24's own estimate rather than a published Swiss figure.",
      );
    });

    // The two flags are independent, so a declared assumption is not also awaiting a reading. A
    // multiplier carrying both badges would tell the client to expect a figure that is never coming.
    it("does not also mark a declared assumption as provisional", async () => {
      const { container } = await renderContent({ assumptions: [multiplier] });
      const item = container.querySelector(
        '[data-assumption="indirect_multiplier"]',
      ) as HTMLElement;
      expect(within(item).queryByText(d.provisional)).not.toBeInTheDocument();
    });

    // A note without the flag is not a declared assumption, so it must stay unrendered: the
    // disclosure reads `note` only when `isAssumption` is true.
    it("renders no badge and no note for an unflagged assumption that carries a note", async () => {
      const { container } = await renderContent({
        assumptions: [
          assumptionUsed("direct_cost_per_case_chf", 4811, {
            isAssumption: false,
            note: { de: "Nicht gezeigt.", en: "Not shown." },
          }),
        ],
      });
      const item = container.querySelector(
        '[data-assumption="direct_cost_per_case_chf"]',
      ) as HTMLElement;
      expect(within(item).queryByText(d.declaredAssumption)).not.toBeInTheDocument();
      expect(item.querySelector("[data-assumption-note]")).not.toBeInTheDocument();
      expect(item).not.toHaveTextContent("Not shown.");
    });

    // A stored @1 or @2 row carries neither field, and must keep rendering rather than breaking
    // (AC-12). The helper's default assumption sets no flag at all.
    it("renders a stored row that carries neither flag nor note", async () => {
      const { container } = await renderContent({
        assumptions: [assumptionUsed("indirect_multiplier", 3.7, { unit: "factor" })],
      });
      const item = container.querySelector(
        '[data-assumption="indirect_multiplier"]',
      ) as HTMLElement;
      expect(within(item).queryByText(d.declaredAssumption)).not.toBeInTheDocument();
      expect(item.querySelector("[data-assumption-note]")).not.toBeInTheDocument();
    });
  });

  // The peer caveat reaches the client instead of dying in the database the way `source_note`
  // does (AC-11). Every seeded row carries a null basis on day one, so the null path is the one
  // that actually ships and it must render nothing at all rather than an empty element.
  describe("the peer basis caveat (spec 0016, AC-11)", () => {
    it("renders the basis sentence for a peer row that carries one", async () => {
      const { container } = await renderContent({
        results: [
          result("accident_rate_per_1000_fte", {
            peer: peer([34.9, 49.9, 66.4], {
              basis: {
                de: "Quartile über Suva Prämienklassen, nicht über NOGA Abschnitte.",
                en: "Quartiles across Suva premium classes, not NOGA sections.",
              },
            }),
            position: "bottom_quarter",
          }),
        ],
      });
      const line = container.querySelector(
        '[data-input-kpi="accident_rate_per_1000_fte"] [data-peer-basis]',
      );
      expect(line).toHaveTextContent("Quartiles across Suva premium classes, not NOGA sections.");
    });

    it("renders no caveat element at all when the basis is null, which is every row today", async () => {
      const { container } = await renderContent();
      expect(container.querySelectorAll("[data-peer-basis]")).toHaveLength(0);
    });

    // A KPI with no peer row has no basis to show either, so the caveat must not appear on a line
    // whose peer is absent.
    it("renders no caveat for a KPI with no peer row", async () => {
      const { container } = await renderContent();
      const trifr = container.querySelector('[data-input-kpi="trifr"]') as HTMLElement;
      expect(trifr.querySelector("[data-peer-basis]")).not.toBeInTheDocument();
    });
  });

  // The inputs list names the value the fatality position was judged on, in the peer row's unit,
  // while the count itself keeps its integer format (spec 0016 amendment, AC-23). The line is for
  // `fatalities` only and only when the row carries a compared value.
  describe("the compared fatality rate (spec 0016 amendment, AC-23)", () => {
    const fatalityPeer = peer([0.55, 0.55, 0.55], { sizeBand: "all", periodYear: 2023 });
    const withFatalities = (comparedValue?: number) => {
      const base = parsedSnapshot().blocks;
      return {
        results: base.results.map((entry) =>
          entry.key === "fatalities"
            ? {
                ...result("fatalities", { peer: fatalityPeer, position: "below_average" }),
                ...(comparedValue === undefined ? {} : { comparedValue }),
              }
            : entry,
        ),
      };
    };

    it("adds the compared rate to the fatalities line and keeps the count's integer format", async () => {
      const { container } = await renderContent(withFatalities(238.1));
      const line = container.querySelector('[data-input-kpi="fatalities"]') as HTMLElement;
      expect(line).toHaveTextContent("1 (2025, from the research)");
      expect(line).toHaveTextContent("peer: Manufacturing · all sizes · 2023");
      expect(line).toHaveTextContent("compared as 238.10 per 100 000 employed persons");
    });

    it("adds no compared line on a stored version 3 result, which carries no compared value", async () => {
      const { container } = await renderContent(withFatalities());
      const line = container.querySelector('[data-input-kpi="fatalities"]') as HTMLElement;
      expect(line).toHaveTextContent("peer: Manufacturing · all sizes · 2023");
      expect(line).not.toHaveTextContent("compared as");
    });

    it("adds no compared line to any other KPI, even when a compared value is stored on it", async () => {
      const base = parsedSnapshot().blocks;
      const { container } = await renderContent({
        results: base.results.map((entry) =>
          entry.key === "accident_rate_per_1000_fte" ? { ...entry, comparedValue: 68 } : entry,
        ),
      });
      expect(
        container.querySelector('[data-input-kpi="accident_rate_per_1000_fte"]'),
      ).not.toHaveTextContent("compared as");
    });
  });

  it("says the headcount and the industry are not known when the inputs lack them", async () => {
    await renderContent({
      inputs: {
        fte: null,
        section: null,
        sizeBand: "all",
        industryCode: null,
        companyUpdatedAt: "2026-09-06T07:00:00.000Z",
        kpis: [inputKpi("ltifr", 2.4)],
      },
      results: [result("ltifr")],
      assumptions: [assumptionUsed("indirect_multiplier", 3.7, { unit: "factor" })],
    });
    expect(screen.getByText(d.noHeadcount)).toBeInTheDocument();
    expect(screen.getByText("Industry: not known, size band all sizes")).toBeInTheDocument();
  });
});
