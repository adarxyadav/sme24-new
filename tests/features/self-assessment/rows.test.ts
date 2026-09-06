// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { type KpiCurrentRow, newestClientMoment, toKpiRows } from "@/features/research/queries";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

/**
 * The narrowed rows (spec 0010, AC-10): a view row with a null id, key, year, value, source or
 * `updated_at`, an unknown key or an unknown source is dropped, the rest are ordered by KPI then
 * year descending, and the newest client `updated_at` is the benchmark moment. Pure.
 */
function row(overrides: Partial<KpiCurrentRow>): KpiCurrentRow {
  return {
    id: "k1",
    organization_id: "o",
    company_id: "c",
    research_run_id: null,
    kpi_key: "ltifr",
    period_year: 2024,
    value: 2.4,
    source: "research",
    confidence: 0.9,
    sources: [],
    note: null,
    created_by: null,
    created_at: "2026-09-06T10:00:00.000Z",
    updated_at: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

describe("toKpiRows", () => {
  it("narrows and orders the rows, dropping incomplete or unknown ones", () => {
    const rows = toKpiRows([
      row({ id: "k3", kpi_key: "trifr", period_year: 2023, value: 5 }),
      row({ id: "k2", period_year: 2023, value: 3.1 }),
      row({ id: "k1", source: "client", updated_at: "2026-09-06T11:00:00.000Z" }),
      row({ id: null }),
      row({ id: "k4", kpi_key: "unknown" }),
      row({ id: "k5", value: null }),
      row({ id: "k6", source: "other" }),
      row({ id: "k7", updated_at: null }),
      row({ id: "k8", period_year: null }),
    ]);
    expect(rows).toEqual([
      {
        id: "k1",
        kpiKey: "ltifr",
        periodYear: 2024,
        value: 2.4,
        source: "client",
        updatedAt: "2026-09-06T11:00:00.000Z",
      },
      {
        id: "k2",
        kpiKey: "ltifr",
        periodYear: 2023,
        value: 3.1,
        source: "research",
        updatedAt: "2026-09-06T10:00:00.000Z",
      },
      {
        id: "k3",
        kpiKey: "trifr",
        periodYear: 2023,
        value: 5,
        source: "research",
        updatedAt: "2026-09-06T10:00:00.000Z",
      },
    ]);
  });
});

describe("newestClientMoment", () => {
  it("is the newest updated_at among the client rows, null without one", () => {
    const rows = toKpiRows([
      row({ id: "a", source: "client", updated_at: "2026-09-06T11:00:00.000Z" }),
      row({ id: "b", kpi_key: "trifr", source: "client", updated_at: "2026-09-06T12:00:00.000Z" }),
      row({ id: "c", kpi_key: "fatalities", updated_at: "2026-09-06T13:00:00.000Z" }),
    ]);
    expect(newestClientMoment(rows)).toBe("2026-09-06T12:00:00.000Z");
    expect(newestClientMoment(rows.filter((entry) => entry.source === "research"))).toBeNull();
  });
});
