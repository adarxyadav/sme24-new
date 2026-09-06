/**
 * The KPI catalogue (spec 0007, AC-1): the eight safety KPIs the research pipeline extracts, in
 * the sort order of the `kpi_definitions` seed. Names and descriptions live in the database
 * (`kpi_definitions.name[locale]`); this file holds what the code needs: the plausible range, the
 * parse rule, the extraction hint the provider and the validator read, and the display format.
 * A Vitest test asserts these keys equal the seeded ones. Pure data, runs anywhere.
 */
export const KPI_KEYS = [
  "ltifr",
  "trifr",
  "fatalities",
  "lost_days_per_incident",
  "accident_rate_per_1000_fte",
  "absenteeism_rate",
  "near_miss_rate",
  "iso_45001_certified",
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

/** How a raw source string becomes a number: a decimal, a whole number, or a yes/no answer as 1/0. */
export type ParseRule = "decimal" | "integer" | "boolean";

/** How the dashboard renders a value (AC-7): two decimals, a whole number, a percentage with one decimal, or yes/no. */
export type KpiFormat = "decimal2" | "integer" | "percent1" | "yesNo";

export type KpiDefinition = {
  readonly key: KpiKey;
  /** The unit every stored value is in (the source unit is converted by the validator). */
  readonly unit: string;
  readonly direction: "lower_is_better" | "higher_is_better";
  /** Values outside this range are dropped as `out_of_range` (AC-5). */
  readonly range: readonly [min: number, max: number];
  readonly parse: ParseRule;
  readonly format: KpiFormat;
  /** One line the provider and the validator read: what to look for and which units to expect. */
  readonly hint: string;
};

export const KPI_CATALOGUE: { readonly [K in KpiKey]: KpiDefinition } = {
  ltifr: {
    key: "ltifr",
    unit: "per 1 000 000 hours worked",
    direction: "lower_is_better",
    range: [0, 100],
    parse: "decimal",
    format: "decimal2",
    hint: "Lost time injury frequency rate (LTIFR, LTIF, LTI rate): lost time injuries per 1 000 000 hours worked; a source per 200 000 hours is multiplied by 5.",
  },
  trifr: {
    key: "trifr",
    unit: "per 1 000 000 hours worked",
    direction: "lower_is_better",
    range: [0, 200],
    parse: "decimal",
    format: "decimal2",
    hint: "Total recordable injury frequency rate (TRIFR, TRIR, TRCF): recordable injuries per 1 000 000 hours worked; a source per 200 000 hours is multiplied by 5.",
  },
  fatalities: {
    key: "fatalities",
    unit: "count",
    direction: "lower_is_better",
    range: [0, 1000],
    parse: "integer",
    format: "integer",
    hint: "Work related fatalities of employees and contractors in the reporting year, as a whole number; zero counts as a value.",
  },
  lost_days_per_incident: {
    key: "lost_days_per_incident",
    unit: "days",
    direction: "lower_is_better",
    range: [0, 365],
    parse: "decimal",
    format: "decimal2",
    hint: "Average lost work days per lost time incident (severity rate per incident); not the total lost days.",
  },
  accident_rate_per_1000_fte: {
    key: "accident_rate_per_1000_fte",
    unit: "per 1 000 full time equivalents",
    direction: "lower_is_better",
    range: [0, 1000],
    parse: "decimal",
    format: "decimal2",
    hint: "Occupational accidents per 1 000 full time equivalents (Swiss Suva convention 'Unfälle pro 1000 Vollbeschäftigte'); a rate per 100 employees is multiplied by 10.",
  },
  absenteeism_rate: {
    key: "absenteeism_rate",
    unit: "percent",
    direction: "lower_is_better",
    range: [0, 100],
    parse: "decimal",
    format: "percent1",
    hint: "Absenteeism rate: absence days as a percentage of scheduled working days (health related absences); 4.5 means 4.5 percent.",
  },
  near_miss_rate: {
    key: "near_miss_rate",
    unit: "per 100 employees",
    direction: "higher_is_better",
    range: [0, 1000],
    parse: "decimal",
    format: "decimal2",
    hint: "Reported near misses per 100 employees in the reporting year; a total count divided by the headcount times 100.",
  },
  iso_45001_certified: {
    key: "iso_45001_certified",
    unit: "yes or no",
    direction: "higher_is_better",
    range: [0, 1],
    parse: "boolean",
    format: "yesNo",
    hint: "Whether an ISO 45001 (or OHSAS 18001) occupational health and safety certification was in force in the reporting year: 1 for yes, 0 for no.",
  },
};

/** The catalogue in sort order. */
export const KPI_LIST: readonly KpiDefinition[] = KPI_KEYS.map((key) => KPI_CATALOGUE[key]);

/** Research runs per organization per rolling 24 hours (AC-2); mirrors `private.research_run_allowed`. */
export const RUN_LIMIT_PER_DAY = 5;

/** Confidence badge thresholds (AC-7): high at or above 0.75, medium at or above 0.4, low below. */
export const CONFIDENCE_HIGH = 0.75;
export const CONFIDENCE_MEDIUM = 0.4;

export type ConfidenceLevel = "high" | "medium" | "low";

/** The badge level of a stored confidence. Pure. */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

/** The earliest reporting year a stored value may carry (AC-5). */
export const MIN_PERIOD_YEAR = 2000;

/** How many reporting years the pipeline asks for: the latest three. */
export const YEARS_PER_RUN = 3;

/** The five progress steps of a run as the dashboard lists them (AC-7); `queued` is the row status, the rest live in `summary.step`. */
export const RUN_STEPS = ["queued", "searching", "extracting", "saving", "done"] as const;
export type RunStep = (typeof RUN_STEPS)[number];

/** True when `value` is one of the catalogue keys. Pure. */
export function isKpiKey(value: unknown): value is KpiKey {
  return typeof value === "string" && (KPI_KEYS as readonly string[]).includes(value);
}

/**
 * Parses a raw source string with the KPI's rule (AC-5, the skipped fallback): the first number
 * in the text (decimal comma accepted, apostrophes and spaces as thousands separators), a whole
 * number for `integer`, and yes/no/certified words for `boolean`. Null when nothing parses. Pure.
 */
export function parseKpiValue(rule: ParseRule, raw: string): number | null {
  const text = raw.trim();
  if (text === "" || /^not found$/i.test(text)) return null;
  if (rule === "boolean") {
    if (/\b(yes|ja|certified|zertifiziert|true|1)\b/i.test(text)) return 1;
    if (/\b(no|nein|not certified|nicht zertifiziert|false|0)\b/i.test(text)) return 0;
    return null;
  }
  const match = text.replace(/['’  ](?=\d{3})/g, "").match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(",", "."));
  if (!Number.isFinite(value)) return null;
  return rule === "integer" ? Math.round(value) : value;
}

/** True when `value` sits inside the KPI's plausible range (AC-5). Pure. */
export function inRange(key: KpiKey, value: number): boolean {
  const [min, max] = KPI_CATALOGUE[key].range;
  return value >= min && value <= max;
}
