import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, type KpiKey } from "../research/catalogue.ts";

/**
 * The benchmark catalogue (spec 0008, AC-3): the NOGA 2008 sections and divisions, the Swiss SME
 * size bands, the KPIs the cost model prices, the assumption keys, the model version and the
 * waiting window. Pure data, runs anywhere; the labels live in the `benchmark.noga` and
 * `benchmark.sizeBands` messages.
 */

export type NogaSection = {
  readonly letter: string;
  /** The first and last two digit division of the section (NOGA 2008, inclusive). */
  readonly divisions: readonly [from: number, to: number];
};

/** The 21 NOGA 2008 sections A to U with their division ranges. */
export const NOGA_SECTIONS: readonly NogaSection[] = [
  { letter: "A", divisions: [1, 3] },
  { letter: "B", divisions: [5, 9] },
  { letter: "C", divisions: [10, 33] },
  { letter: "D", divisions: [35, 35] },
  { letter: "E", divisions: [36, 39] },
  { letter: "F", divisions: [41, 43] },
  { letter: "G", divisions: [45, 47] },
  { letter: "H", divisions: [49, 53] },
  { letter: "I", divisions: [55, 56] },
  { letter: "J", divisions: [58, 63] },
  { letter: "K", divisions: [64, 66] },
  { letter: "L", divisions: [68, 68] },
  { letter: "M", divisions: [69, 75] },
  { letter: "N", divisions: [77, 82] },
  { letter: "O", divisions: [84, 84] },
  { letter: "P", divisions: [85, 85] },
  { letter: "Q", divisions: [86, 88] },
  { letter: "R", divisions: [90, 93] },
  { letter: "S", divisions: [94, 96] },
  { letter: "T", divisions: [97, 98] },
  { letter: "U", divisions: [99, 99] },
];

export type SectionLetter = (typeof NOGA_SECTIONS)[number]["letter"];

/** The 88 two digit NOGA 2008 divisions that exist, in order (04, 34, 40, 44, 48, 54, 57, 67, 76, 83, 89 do not). */
export const NOGA_DIVISIONS: readonly string[] = NOGA_SECTIONS.flatMap(
  ({ divisions: [from, to] }) =>
    Array.from({ length: to - from + 1 }, (_, index) => String(from + index).padStart(2, "0")),
);

/**
 * The section letter of a NOGA code (`dd` or `dd.dd`), or `null` when the code is not a known
 * division. Pure.
 */
export function sectionOfDivision(code: string | null | undefined): string | null {
  if (!code) return null;
  const match = code.trim().match(/^(\d{2})(?:\.\d{2})?$/);
  if (!match) return null;
  const division = Number(match[1]);
  const section = NOGA_SECTIONS.find(
    ({ divisions: [from, to] }) => division >= from && division <= to,
  );
  return section?.letter ?? null;
}

/** The Swiss SME size bands as the Federal Statistical Office uses them, plus `all`. */
export const SIZE_BANDS = ["1-49", "50-249", "250+", "all"] as const;
export type SizeBand = (typeof SIZE_BANDS)[number];

/** The size band of a headcount: `all` for `null` or 0 (no headcount known). Pure. */
export function sizeBandOf(employees: number | null | undefined): SizeBand {
  if (!employees || employees <= 0) return "all";
  if (employees <= 49) return "1-49";
  if (employees <= 249) return "50-249";
  return "250+";
}

/** The KPIs whose gap carries a CHF saving in the ranking (spec 0008, AC-18 rule 6). */
export const COST_LINKED_KPIS: readonly KpiKey[] = [
  "accident_rate_per_1000_fte",
  "ltifr",
  "lost_days_per_incident",
];

/** The four KPIs a named peer may publish (spec 0021, AC-2); the library holds no other. */
export const PEER_KPI_KEYS = [
  "ltifr",
  "trifr",
  "lost_days_per_incident",
  "iso_45001_certified",
] as const;
export type PeerKpiKey = (typeof PEER_KPI_KEYS)[number];

/** How many report years back a published figure still counts (spec 0021, AC-6): the current year minus three. */
export const PEER_YEARS_BACK = 3;

/** The fewest named peers a KPI needs before a rung counts (spec 0021, AC-6). */
export const PEER_MINIMUM = 3;

/** The most peers the chart slice draws, chosen nearest in headcount (spec 0021, AC-9). */
export const PEER_CHART_LIMIT = 6;

/** The four rungs of the geography ladder, in the order climbed (spec 0021, AC-6). */
export const GEO_RUNGS = ["country", "region", "europe", "world"] as const;
export type GeoRung = (typeof GEO_RUNGS)[number];

/** The seven stored constants of the cost model, in the order the disclosure lists them. */
export const ASSUMPTION_KEYS = [
  "hours_per_fte",
  "direct_cost_per_case_chf",
  "cost_per_absence_day_chf",
  "lost_days_per_incident_default",
  "indirect_multiplier_low",
  "indirect_multiplier",
  "indirect_multiplier_high",
] as const;
export type AssumptionKey = (typeof ASSUMPTION_KEYS)[number];

/**
 * Names the rule set and snapshot schema; bumped by hand when a formula or rule changes. `@4`
 * (spec 0016 amendment of 2026-09-12): a peer reference of 0 prices to zero incidents, fatalities
 * compare as a rate per 100 000 employed persons, and a missing assumption gives a null cost.
 * `@5` (spec 0021): the named published peer blocks and `inputs.country`; no formula changes.
 */
export const MODEL_VERSION = "benchmark-model@5";

/** True for a model version that carries the named peer blocks (`@5` and later, spec 0021). Pure. */
export function isPeerVersion(modelVersion: string): boolean {
  const match = /^benchmark-model@(\d+)$/.exec(modelVersion);
  return match !== null && Number(match[1]) >= 5;
}

/** How long the dashboard shows "calculating" after a trigger moment before it says "not available yet" (AC-9). */
export const BENCHMARK_WAIT_MS = 120_000;

/** The confidence thresholds of the research catalogue, re exported so the card reads one place. */
export const BENCHMARK_CONFIDENCE = { high: CONFIDENCE_HIGH, medium: CONFIDENCE_MEDIUM } as const;

/** The three trigger kinds a snapshot records. */
export const TRIGGER_KINDS = ["research", "client_edit", "recompute"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/** The four dashboard states derived from the newest snapshot (spec 0008, AC-9). */
export const BENCHMARK_STATES = ["ready", "calculating", "unavailable", "noData"] as const;
export type BenchmarkState = (typeof BENCHMARK_STATES)[number];
