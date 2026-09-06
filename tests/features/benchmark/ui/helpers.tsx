import { render } from "@testing-library/react";
import { createFormatter, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { AssumptionRow, ParsedSnapshot } from "@/features/benchmark/queries";
import type {
  AssumptionUsed,
  InputKpi,
  SnapshotBlocks,
  SnapshotGap,
  SnapshotPeer,
  SnapshotResult,
} from "@/features/benchmark/snapshot";
import type { KpiKey } from "@/features/research/catalogue";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { definition, en } from "../../research/ui/helpers";

export { definition, en };

export const COMPANY_ID = "0c000000-0000-4000-8000-00000000000a";
export const SNAPSHOT_ID = "0e000000-0000-4000-8000-000000000001";
const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** The English formatter the server components read, so a test builds the exact string it expects. */
export const enFormat = createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE });

/** Renders a server rendered element under the English catalog, the named formats and the Swiss time zone. */
export function renderEnglish(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** A KPI input as the task stores it in `inputs.kpis`. */
export function inputKpi(key: KpiKey, value: number, overrides: Partial<InputKpi> = {}): InputKpi {
  return {
    key,
    rowId: UUID(100 + KPI_INDEX.indexOf(key)),
    value,
    periodYear: 2025,
    source: "research",
    confidence: 0.9,
    researchRunId: UUID(9),
    ...overrides,
  };
}

const KPI_INDEX: readonly KpiKey[] = [
  "accident_rate_per_1000_fte",
  "ltifr",
  "trifr",
  "lost_days_per_incident",
  "absenteeism_rate",
  "fatalities",
  "iso_45001_certified",
  "near_miss_rate",
];

/** A peer selection as the task stores it on a result. */
export function peer(
  [p25, median, p75]: readonly [number, number, number],
  overrides: Partial<SnapshotPeer> = {},
): SnapshotPeer {
  return {
    rowId: UUID(500),
    rung: 1,
    industrySection: "C",
    sizeBand: "250+",
    periodYear: 2022,
    yearMatch: "same",
    p25,
    median,
    p75,
    sampleSize: null,
    provisional: true,
    ...overrides,
  };
}

export function result(key: KpiKey, overrides: Partial<SnapshotResult> = {}): SnapshotResult {
  return {
    key,
    peer: null,
    position: null,
    gapToMedian: null,
    gapRelative: null,
    confidence: 0.9,
    ...overrides,
  };
}

export function gap(rank: number, key: KpiKey, overrides: Partial<SnapshotGap> = {}): SnapshotGap {
  return { rank, key, reason: "distance", savingMedianChf: null, gapRelative: null, ...overrides };
}

export function assumptionUsed(
  key: AssumptionUsed["key"],
  value: number,
  overrides: Partial<AssumptionUsed> = {},
): AssumptionUsed {
  return {
    key,
    value,
    unit: "CHF per case",
    sourceName: "Suva statistics",
    sourceUrl: null,
    provisional: true,
    effectiveFrom: "2022-12-31",
    ...overrides,
  };
}

/** A `benchmark_assumptions` row for the disclosure labels. */
export function assumptionRow(key: string, overrides: Partial<AssumptionRow> = {}): AssumptionRow {
  return {
    key,
    value: 1,
    unit: "factor",
    label: { de: `${key} (de)`, en: `${key} (en)` },
    source_name: "Suva statistics",
    source_url: null,
    note: null,
    provisional: true,
    effective_from: "2022-12-31",
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

/** The dashboard catalogue: eight active KPIs in sort order, so "n of 8 KPIs compared" holds. */
export const catalogue = [
  definition("accident_rate_per_1000_fte", { sort_order: 1, unit: "per 1 000 FTE" }),
  definition("ltifr", { sort_order: 2 }),
  definition("trifr", { sort_order: 3 }),
  definition("lost_days_per_incident", { sort_order: 4, unit: "days" }),
  definition("absenteeism_rate", { sort_order: 5, unit: "percent" }),
  definition("fatalities", { sort_order: 6, unit: "count" }),
  definition("iso_45001_certified", {
    sort_order: 7,
    unit: "yes or no",
    direction: "higher_is_better",
  }),
  definition("near_miss_rate", { sort_order: 8, direction: "higher_is_better" }),
];

/** The blocks of a snapshot that priced the accident rate against a section peer. */
export function readyBlocks(overrides: Partial<SnapshotBlocks> = {}): SnapshotBlocks {
  return {
    inputs: {
      fte: 420,
      section: "C",
      sizeBand: "250+",
      industryCode: "23.61",
      companyUpdatedAt: "2026-09-06T07:00:00.000Z",
      kpis: [
        inputKpi("accident_rate_per_1000_fte", 68, { confidence: 0.8 }),
        inputKpi("ltifr", 2.4),
        inputKpi("trifr", 6.1),
        inputKpi("lost_days_per_incident", 12.5, { source: "client", confidence: 1 }),
        inputKpi("absenteeism_rate", 3.8),
        inputKpi("fatalities", 1, { confidence: 0.95 }),
        inputKpi("iso_45001_certified", 1, { confidence: null }),
      ],
    },
    results: [
      result("accident_rate_per_1000_fte", {
        peer: peer([34.9, 49.9, 66.4], { sampleSize: 120 }),
        position: "bottom_quarter",
        gapToMedian: 18.1,
        gapRelative: 0.363,
        confidence: 0.8,
      }),
      result("ltifr", {
        peer: peer([1, 2, 4], {
          rowId: UUID(501),
          rung: 4,
          industrySection: "ALL",
          sizeBand: "all",
          periodYear: 2021,
          yearMatch: "nearest",
        }),
        position: "above_median",
        gapToMedian: 0.4,
        gapRelative: 0.2,
      }),
      result("trifr"),
      result("lost_days_per_incident", {
        peer: peer([8, 10, 14], { rowId: UUID(502), rung: 3, industrySection: "ALL" }),
        position: "below_median",
        gapToMedian: 2.5,
        gapRelative: 0.25,
        confidence: 1,
      }),
      result("absenteeism_rate", {
        peer: peer([2.5, 3.5, 4.5], { rowId: UUID(503), rung: 2, sizeBand: "all" }),
        position: "below_median",
        gapToMedian: 0.3,
        gapRelative: 0.086,
      }),
      result("fatalities", { confidence: 0.95 }),
      result("iso_45001_certified", {
        peer: peer([0.3, 0.3, 0.3], {
          rowId: UUID(504),
          rung: 4,
          industrySection: "ALL",
          sizeBand: "all",
        }),
        position: "above_median",
        gapToMedian: 0,
        gapRelative: 0,
        confidence: null,
      }),
    ],
    gaps: [
      gap(1, "fatalities", { reason: "fatality" }),
      gap(2, "accident_rate_per_1000_fte", {
        reason: "cost",
        savingMedianChf: 522_340,
        gapRelative: 0.363,
      }),
      gap(3, "lost_days_per_incident", {
        reason: "cost",
        savingMedianChf: 88_120,
        gapRelative: 0.25,
      }),
      gap(4, "absenteeism_rate", { gapRelative: 0.086 }),
    ],
    cost: {
      incidentKpi: "accident_rate_per_1000_fte",
      incidents: 28.56,
      lostDays: 12.5,
      lostDaysSource: "kpi",
      costPerCase: 18_561,
      annual: 1_961_340,
      low: 1_060_180,
      high: 2_650_450,
      atMedian: 1_439_000,
      atTop: 1_006_000,
      savingMedian: 522_340,
      savingTop: 955_340,
    },
    assumptions: [
      assumptionUsed("direct_cost_per_case_chf", 4811, {
        sourceUrl: "https://www.suva.ch/statistik",
      }),
      assumptionUsed("cost_per_absence_day_chf", 1100, { unit: "CHF per day", provisional: false }),
      assumptionUsed("indirect_multiplier", 3.7, { unit: "factor" }),
    ],
    ...overrides,
  };
}

/** A parsed snapshot as the dashboard query hands it to the segment. */
export function parsedSnapshot(
  overrides: Partial<ParsedSnapshot> = {},
  blocks: Partial<SnapshotBlocks> = {},
): ParsedSnapshot {
  return {
    id: SNAPSHOT_ID,
    createdAt: "2026-09-06T08:00:00.000Z",
    triggerKind: "research",
    modelVersion: "benchmark-model@1",
    kpisCompared: 5,
    peerProvisional: true,
    confidence: 0.8,
    costChf: 1_961_340,
    costLowChf: 1_060_180,
    costHighChf: 2_650_450,
    savingMedianChf: 522_340,
    savingTopChf: 955_340,
    blocks: readyBlocks(blocks),
    ...overrides,
  };
}

/** The company facts the segment passes to the form. */
export const company = { id: COMPANY_ID, industryCode: "23.61", employeesCount: 420 };
