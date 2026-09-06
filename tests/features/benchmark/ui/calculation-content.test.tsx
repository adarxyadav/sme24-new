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
