import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KPI_LIST } from "@/features/research/catalogue";
import type { KpiRow } from "@/features/research/queries";
import type {
  ClearClientKpiData,
  SaveClientKpisData,
  SelfAssessmentActionResult,
} from "@/features/self-assessment/actions";
import {
  changedValues,
  KpiForm,
  type KpiFormField,
  prefillValues,
} from "@/features/self-assessment/ui/kpi-form";
import { en, renderWithIntl } from "../../emails/ui/helpers";

/**
 * The self assessment form (spec 0010, AC-3, AC-4, AC-7, AC-11): the fields prefill from the
 * current rows of the default year with a caption per source, a clear button sits only beside a
 * client value, only changed fields reach the action (a blanked prefilled field is a no op), an
 * untouched form explains that nothing changed, a bad figure is explained next to its field, a
 * success or a clear announces the recalculation and refreshes, a conflict asks for a reload,
 * and a year change refills every field and shows the older year hint. The two actions and the
 * router are the boundaries.
 */
type SaveResult = SelfAssessmentActionResult<SaveClientKpisData>;
type ClearResult = SelfAssessmentActionResult<ClearClientKpiData>;

const boundary = vi.hoisted(() => ({
  save: vi.fn<(previous: SaveResult | null, input: unknown) => Promise<SaveResult>>(),
  clear: vi.fn<(previous: ClearResult | null, input: unknown) => Promise<ClearResult>>(),
  refresh: vi.fn(),
}));

vi.mock("@/features/self-assessment/actions", () => ({
  saveClientKpis: boundary.save,
  clearClientKpi: boundary.clear,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/app",
  useSearchParams: () => new URLSearchParams(),
}));

const strings = en.selfAssessment;
const COMPANY_ID = "0c000000-0000-4000-8000-00000000000a";
const fields: readonly KpiFormField[] = KPI_LIST.map((definition) => ({
  key: definition.key,
  name: `${definition.key} (en)`,
  description: `Description ${definition.key}`,
  unit: definition.unit,
  format: definition.format,
}));

function kpiRow(overrides: Partial<KpiRow> & Pick<KpiRow, "id" | "kpiKey">): KpiRow {
  return {
    periodYear: 2024,
    value: 1,
    source: "research",
    updatedAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

const rows: readonly KpiRow[] = [
  kpiRow({ id: "r1", kpiKey: "ltifr", value: 2.4 }),
  kpiRow({ id: "r2", kpiKey: "ltifr", periodYear: 2023, value: 3.1 }),
  kpiRow({ id: "r3", kpiKey: "accident_rate_per_1000_fte", value: 68 }),
  kpiRow({ id: "r4", kpiKey: "iso_45001_certified", value: 1 }),
  kpiRow({ id: "c1", kpiKey: "trifr", value: 6.1, source: "client" }),
];

function renderForm(overrides: Partial<Parameters<typeof KpiForm>[0]> = {}) {
  return renderWithIntl(
    <KpiForm
      companyId={COMPANY_ID}
      fields={fields}
      rows={rows}
      currentYear={2026}
      {...overrides}
    />,
    "en-CH",
  );
}

const field = (key: string) => screen.getByRole("textbox", { name: `${key} (en)` });
const caption = (key: string) =>
  document.querySelector(`[data-kpi-field="${key}"] [data-source-caption]`);
const saveButton = () => screen.getByRole("button", { name: strings.submit });
const clearName = (key: string) => strings.clear.replace("{kpi}", `${key} (en)`);

beforeAll(() => {
  // Radix Select needs the pointer capture and scroll APIs jsdom does not ship.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

beforeEach(() => {
  boundary.save.mockReset();
  boundary.clear.mockReset();
  boundary.refresh.mockReset();
  boundary.save.mockResolvedValue({
    ok: true,
    data: { companyId: COMPANY_ID, periodYear: 2024, saved: ["ltifr"], benchmarkQueued: true },
  });
  boundary.clear.mockResolvedValue({
    ok: true,
    data: { companyId: COMPANY_ID, kpiKey: "trifr", periodYear: 2024, benchmarkQueued: true },
  });
});

describe("prefillValues and changedValues (AC-3, AC-4)", () => {
  it("prefills the text of the row for the year, yes or no as 1 or 0, and empty otherwise", () => {
    const values = prefillValues(fields, rows, 2024);
    expect(values.ltifr).toBe("2.4");
    expect(values.trifr).toBe("6.1");
    expect(values.iso_45001_certified).toBe("1");
    expect(values.fatalities).toBe("");
    expect(prefillValues(fields, rows, 2023).ltifr).toBe("3.1");
    expect(prefillValues(fields, rows, 2023).trifr).toBe("");
  });

  it("keeps only the values that differ from the prefilled ones", () => {
    const prefilled = prefillValues(fields, rows, 2024);
    const changed = changedValues({ ...prefilled, ltifr: "2.9", fatalities: " " }, prefilled);
    expect(changed.ltifr).toBe("2.9");
    expect(changed.trifr).toBeUndefined();
    expect(changed.fatalities).toBeUndefined();
  });
});

describe("KpiForm (AC-3, AC-7)", () => {
  it("starts on the newest year on file, prefills the fields and captions each source", () => {
    renderForm();
    expect(screen.getByRole("combobox", { name: strings.year })).toHaveTextContent("2024");
    expect(field("ltifr")).toHaveValue("2.4");
    expect(field("ltifr")).toHaveAttribute("inputmode", "decimal");
    expect(field("fatalities")).toHaveAttribute("inputmode", "numeric");
    expect(caption("ltifr")).toHaveTextContent(strings.source.research);
    expect(caption("trifr")).toHaveTextContent(strings.source.client);
    expect(caption("fatalities")).toHaveTextContent(strings.source.none);
    expect(screen.getByRole("combobox", { name: "iso_45001_certified (en)" })).toHaveTextContent(
      strings.yesNo.yes,
    );
    expect(screen.getByRole("button", { name: clearName("trifr") })).toBeVisible();
    expect(screen.queryByRole("button", { name: clearName("ltifr") })).toBeNull();
    expect(document.querySelector("[data-older-year-hint]")).toBeNull();
    // LTIFR and TRIFR share the unit, shown beside each input.
    expect(screen.getAllByText("per 1 000 000 hours worked", { selector: "span" })).toHaveLength(2);
  });

  it("sends only the changed fields, then announces the recalculation and refreshes", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(field("ltifr"));
    await user.type(field("ltifr"), "2,9");
    await user.click(saveButton());
    await waitFor(() => expect(boundary.save).toHaveBeenCalledTimes(1));
    const input = boundary.save.mock.calls[0]?.[1] as {
      companyId: string;
      periodYear: number;
      values: Record<string, unknown>;
      locale: string;
    };
    expect(input.companyId).toBe(COMPANY_ID);
    expect(input.periodYear).toBe(2024);
    expect(input.locale).toBe("en-CH");
    expect(input.values.ltifr).toBe(2.9);
    expect(input.values.trifr).toBeUndefined();
    expect(input.values.accident_rate_per_1000_fte).toBeUndefined();
    expect(input.values.iso_45001_certified).toBeUndefined();
    expect(await screen.findByRole("status")).toHaveTextContent(strings.saved);
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalled());
  });

  it("treats a blanked prefilled field as untouched", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(field("ltifr"));
    await user.type(field("fatalities"), "1");
    await user.click(saveButton());
    await waitFor(() => expect(boundary.save).toHaveBeenCalledTimes(1));
    const input = boundary.save.mock.calls[0]?.[1] as { values: Record<string, unknown> };
    expect(input.values.fatalities).toBe(1);
    expect(input.values.ltifr).toBeUndefined();
  });

  it("explains an untouched form under the year and a bad figure next to its field", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(saveButton());
    expect(await screen.findByText(strings.validation.nothingToSave)).toBeVisible();
    expect(boundary.save).not.toHaveBeenCalled();
    await user.type(field("fatalities"), "1.5");
    await user.click(saveButton());
    expect(await screen.findByText(strings.validation.valueInvalid)).toBeVisible();
    expect(field("fatalities")).toHaveAttribute("aria-invalid", "true");
    expect(boundary.save).not.toHaveBeenCalled();
  });

  it("announces the not queued variant and the action errors", async () => {
    const user = userEvent.setup();
    boundary.save.mockResolvedValueOnce({
      ok: true,
      data: {
        companyId: COMPANY_ID,
        periodYear: 2024,
        saved: ["fatalities"],
        benchmarkQueued: false,
      },
    });
    const { unmount } = renderForm();
    await user.type(field("fatalities"), "2");
    await user.click(saveButton());
    expect(await screen.findByRole("status")).toHaveTextContent(strings.savedNotQueued);
    unmount();

    boundary.save.mockResolvedValueOnce({ ok: false, error: "conflict" });
    renderForm();
    await user.type(field("fatalities"), "2");
    await user.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(strings.errors.conflict);
  });

  it("clears a client value through its own action, announces it and refreshes", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: clearName("trifr") }));
    await waitFor(() => expect(boundary.clear).toHaveBeenCalledTimes(1));
    expect(boundary.clear.mock.calls[0]?.[1]).toEqual({
      companyId: COMPANY_ID,
      kpiKey: "trifr",
      periodYear: 2024,
      locale: "en-CH",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(strings.cleared);
    await waitFor(() => expect(boundary.refresh).toHaveBeenCalled());
  });

  it("refills every field on a year change and lists the KPIs with a newer year in the hint", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(field("fatalities"), "3");
    await user.click(screen.getByRole("combobox", { name: strings.year }));
    await user.click(await screen.findByRole("option", { name: "2023" }));
    await waitFor(() => expect(field("ltifr")).toHaveValue("3.1"));
    expect(field("trifr")).toHaveValue("");
    expect(field("fatalities")).toHaveValue("");
    expect(caption("trifr")).toHaveTextContent(strings.source.none);
    expect(screen.queryByRole("button", { name: clearName("trifr") })).toBeNull();
    const hint = document.querySelector("[data-older-year-hint]") as HTMLElement;
    expect(hint).toHaveTextContent(strings.olderYearIntro);
    expect(hint).toHaveTextContent("accident_rate_per_1000_fte (en)");
    expect(hint).toHaveTextContent("trifr (en)");
    expect(hint).toHaveTextContent("2024");
    expect(within(hint).queryByText("ltifr (en)")).toBeNull();
  });
});
