import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DashboardKpi } from "@/features/research/queries";
import { KpiTable, localizedText } from "@/features/research/ui/kpi-table";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { definition, en, RUN_ID } from "./helpers";

/**
 * The KPI table (spec 0007, AC-7): one row per catalogue KPI in sort order, one column per year,
 * every value formatted by the catalogue's rule with its confidence badge, a "not verified" mark
 * when the row's run skipped validation, the sources of a cell in a popover, "not found" for an
 * empty cell, and the coverage line. The server translator and formatter are the boundary; they
 * read the English catalog here.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en-CH", messages: en, namespace: namespace as never, formats }),
  getFormatter: async () => createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE }),
}));

const catalogue = [
  definition("ltifr", { sort_order: 1 }),
  definition("fatalities", { sort_order: 2, unit: "count" }),
  definition("absenteeism_rate", { sort_order: 3, unit: "percent" }),
  definition("iso_45001_certified", { sort_order: 4, unit: "yes or no" }),
];

function row(overrides: Partial<DashboardKpi>): DashboardKpi {
  return {
    id: "k1",
    organization_id: "o",
    company_id: "c",
    kpi_key: "ltifr",
    period_year: 2025,
    value: 2.4,
    confidence: 0.9,
    source: "research",
    sources: [
      {
        url: "https://www.example.ch/reports/sustainability-report",
        title: "Sustainability report",
        excerpt: "LTIFR 2025: 2.4",
        retrievedAt: "2026-09-06T10:00:00.000Z",
      },
    ],
    research_run_id: RUN_ID,
    note: null,
    created_by: null,
    created_at: null,
    updated_at: null,
    validation: "passed",
    ...overrides,
  };
}

const kpis: readonly DashboardKpi[] = [
  row({}),
  row({ id: "k2", period_year: 2024, value: 2.7, confidence: 0.5, validation: "skipped" }),
  row({ id: "k3", kpi_key: "fatalities", value: 0, confidence: 0.95, sources: [] }),
  row({ id: "k4", kpi_key: "absenteeism_rate", value: 3.8, confidence: 0.3 }),
  row({ id: "k5", kpi_key: "iso_45001_certified", value: 1, confidence: null }),
];

async function renderTable(overrides: Partial<Parameters<typeof KpiTable>[0]> = {}) {
  const element = await KpiTable({
    catalogue,
    years: [2025, 2024, 2023],
    kpis,
    locale: "en",
    ...overrides,
  });
  return render(
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
      <TooltipProvider>{element}</TooltipProvider>
    </NextIntlClientProvider>,
  );
}

function cell(kpi: string, year: number) {
  const tr = screen.getByRole("row", { name: new RegExp(`^${kpi} \\(en\\)`) });
  const cells = within(tr).getAllByRole("cell");
  const index = 2 + [2025, 2024, 2023].indexOf(year);
  return cells[index] as HTMLElement;
}

describe("localizedText", () => {
  it("reads the requested language from a {de, en} column and gives an empty string otherwise", () => {
    expect(localizedText({ de: "Rate", en: "Rate (en)" }, "de")).toBe("Rate");
    expect(localizedText({ de: "Rate" }, "en")).toBe("");
    expect(localizedText(null, "en")).toBe("");
    expect(localizedText("Rate", "en")).toBe("");
  });
});

describe("KpiTable (AC-7)", () => {
  it("lists every catalogue KPI in order with its name, description and unit, and one column per year", async () => {
    await renderTable();
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual([
      en.research.table.kpi,
      en.research.table.unit,
      "2025",
      "2024",
      "2023",
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((tr) => tr.getAttribute("data-kpi"))).toEqual([
      "ltifr",
      "fatalities",
      "absenteeism_rate",
      "iso_45001_certified",
    ]);
    expect(within(rows[0] as HTMLElement).getByText("Description ltifr")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("count")).toBeInTheDocument();
  });

  it("counts the KPIs with at least one value in the coverage line", async () => {
    await renderTable();
    expect(screen.getByText("4 of 4 KPIs found")).toHaveAttribute("data-coverage", "4");
  });

  it("formats each value by the catalogue rule: two decimals, a whole number, a percentage, yes or no", async () => {
    await renderTable();
    expect(cell("ltifr", 2025)).toHaveTextContent("2.40");
    expect(cell("fatalities", 2025)).toHaveTextContent("0");
    expect(cell("absenteeism_rate", 2025)).toHaveTextContent("3.8%");
    expect(cell("iso_45001_certified", 2025)).toHaveTextContent(en.research.table.yes);
  });

  it("shows not found for an empty cell and for a null value", async () => {
    await renderTable({
      kpis: [...kpis, row({ id: "k6", kpi_key: "fatalities", period_year: 2023, value: null })],
    });
    expect(cell("ltifr", 2023)).toHaveTextContent(en.research.table.notFound);
    expect(cell("fatalities", 2023)).toHaveTextContent(en.research.table.notFound);
    expect(cell("fatalities", 2024)).toHaveTextContent(en.research.table.notFound);
  });

  it("badges the confidence per cell and leaves it out when the row has none", async () => {
    await renderTable();
    expect(within(cell("ltifr", 2025)).getByText("High")).toHaveAttribute(
      "data-confidence",
      "high",
    );
    expect(within(cell("ltifr", 2024)).getByText("Medium")).toBeInTheDocument();
    expect(within(cell("absenteeism_rate", 2025)).getByText("Low")).toBeInTheDocument();
    expect(
      within(cell("iso_45001_certified", 2025)).queryByText(/High|Medium|Low/),
    ).not.toBeInTheDocument();
  });

  it("marks a value whose run skipped validation as not verified, reachable by keyboard", async () => {
    await renderTable();
    const mark = within(cell("ltifr", 2024)).getByText(en.research.table.notVerified);
    expect(mark).toHaveAttribute("tabindex", "0");
    expect(
      within(cell("ltifr", 2025)).queryByText(en.research.table.notVerified),
    ).not.toBeInTheDocument();
  });

  it("opens the sources of a cell in a popover with title, link, excerpt and date, and offers none for a cell without sources", async () => {
    const user = userEvent.setup();
    await renderTable();
    const trigger = within(cell("ltifr", 2025)).getByRole("button", {
      name: "Sources for ltifr (en), 2025",
    });
    expect(trigger).toHaveTextContent("1 source");
    await user.click(trigger);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Sustainability report" })).toHaveAttribute(
      "href",
      "https://www.example.ch/reports/sustainability-report",
    );
    expect(within(dialog).getByRole("link")).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(dialog).getByText("“LTIFR 2025: 2.4”")).toBeInTheDocument();
    expect(within(dialog).getByText("Retrieved 06.09.2026")).toBeInTheDocument();
    expect(within(cell("fatalities", 2025)).queryByRole("button")).not.toBeInTheDocument();
  });

  it("falls back to the key when the catalogue row has no name in the language", async () => {
    const { container } = await renderTable({
      catalogue: [definition("ltifr", { name: { de: "Rate" } })],
      locale: "en",
    });
    const tr = container.querySelector('tr[data-kpi="ltifr"]') as HTMLElement;
    expect(within(tr).getByText("ltifr")).toBeInTheDocument();
    expect(within(tr).queryByText("Rate")).not.toBeInTheDocument();
  });
});
