import { CONFIDENCE_HIGH, CONFIDENCE_MEDIUM } from "../research/catalogue.ts";

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

/**
 * The English name of every section, for the one caller that cannot read a message catalogue: the
 * peer search objective the `research-peers` task sends the provider (spec 0022, AC-5) runs in a
 * task, where next-intl is not available and the provider reads English either way. The client
 * facing labels stay in `benchmark.noga.sections.*` in both catalogs; these must match the English
 * ones, which `tests/features/benchmark/catalogue.test.ts` checks. Pure data.
 */
export const SECTION_NAMES_EN: Readonly<Record<string, string>> = {
  A: "Agriculture, forestry and fishing",
  B: "Mining and quarrying",
  C: "Manufacturing",
  D: "Electricity, gas, steam and air conditioning supply",
  E: "Water supply, sewerage, waste management",
  F: "Construction",
  G: "Wholesale and retail trade, repair of motor vehicles",
  H: "Transportation and storage",
  I: "Accommodation and food service activities",
  J: "Information and communication",
  K: "Financial and insurance activities",
  L: "Real estate activities",
  M: "Professional, scientific and technical activities",
  N: "Administrative and support service activities",
  O: "Public administration and defence, compulsory social security",
  P: "Education",
  Q: "Human health and social work activities",
  R: "Arts, entertainment and recreation",
  S: "Other service activities",
  T: "Activities of households as employers",
  U: "Activities of extraterritorial organisations and bodies",
};

/** The English name of a section letter, the letter itself when it is not one of the 21. Pure. */
export function sectionNameEn(letter: string): string {
  return SECTION_NAMES_EN[letter] ?? letter;
}

/**
 * Names the rule set and snapshot schema; bumped by hand when a formula or rule changes. `@7`
 * (spec 0022, AC-12): the peers of one research run replace the curated sector rows, the owner's
 * loss table replaces the cost model and its seven stored assumptions, and the body is `inputs`,
 * `peers`, `loss` and `recommendation`. The `@1` to `@6` schemas were deleted with the model they
 * described, so a stored row of any earlier version is `outdated` rather than readable (AC-18).
 */
export const MODEL_VERSION = "benchmark-model@7";

/** How long the dashboard shows "calculating" after a trigger moment before it says "not available yet" (AC-9). */
export const BENCHMARK_WAIT_MS = 120_000;

/** The confidence thresholds of the research catalogue, re exported so the card reads one place. */
export const BENCHMARK_CONFIDENCE = { high: CONFIDENCE_HIGH, medium: CONFIDENCE_MEDIUM } as const;

/** The three trigger kinds a snapshot records. */
export const TRIGGER_KINDS = ["research", "client_edit", "recompute"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

/**
 * The five dashboard states derived from the newest snapshot (spec 0008, AC-9; spec 0022, AC-18).
 * `outdated` is the newest snapshot being of a model version this code no longer reads: nothing
 * from the stored row is rendered and the segment offers the rerun instead.
 */
export const BENCHMARK_STATES = [
  "ready",
  "calculating",
  "unavailable",
  "noData",
  "outdated",
] as const;
export type BenchmarkState = (typeof BENCHMARK_STATES)[number];
