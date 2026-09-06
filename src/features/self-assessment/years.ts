import { isKpiKey, type KpiKey, MIN_PERIOD_YEAR } from "@/features/research/catalogue";
import { TIME_ZONE } from "@/i18n/formats";

/**
 * The year rules of the self assessment form (spec 0010, AC-2, AC-7): which years the picker
 * offers, which one it starts on, and which KPIs already carry a newer year than the chosen one.
 * Pure, runs anywhere.
 */

/** How many years below the current one the picker always offers (AC-2). */
export const YEARS_BACK = 4;

type YearRule = {
  /** The distinct `period_year` values on file for the company, in any order. */
  readonly yearsOnFile: readonly number[];
  readonly currentYear: number;
};

/** The calendar year of `now` in `Europe/Zurich`, so the first UTC hour of New Year's Day still counts as the new year. Pure. */
export function currentYear(now: Date): number {
  const formatted = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric" })
    .formatToParts(now)
    .find((part) => part.type === "year");
  return Number(formatted?.value ?? now.getUTCFullYear());
}

/**
 * The years the picker lists (AC-2): one contiguous run, newest first, from the current year down
 * to the smaller of the current year minus four and the oldest year on file, never below 2000 and
 * never above the current year. Pure.
 */
export function yearOptions({ yearsOnFile, currentYear }: YearRule): readonly number[] {
  const oldestOnFile = Math.min(...yearsOnFile, Number.POSITIVE_INFINITY);
  const floor = Math.max(MIN_PERIOD_YEAR, Math.min(currentYear - YEARS_BACK, oldestOnFile));
  return Array.from({ length: currentYear - floor + 1 }, (_, index) => currentYear - index);
}

/** The year the picker starts on (AC-2): the newest year on file, capped at the current year, else the current year minus one. Pure. */
export function defaultYear({ yearsOnFile, currentYear }: YearRule): number {
  if (yearsOnFile.length === 0) return currentYear - 1;
  return Math.min(Math.max(...yearsOnFile), currentYear);
}

export type NewerYear = { readonly key: KpiKey; readonly year: number };

/**
 * The KPIs whose newest year on file is later than `year` (AC-7), each with that newest year,
 * in the order of the rows given. The benchmark reads the newest year per KPI, so a value saved
 * for an older year does not change it. Pure.
 */
export function newerYearsThan(
  rows: ReadonlyArray<{ readonly kpiKey: string; readonly periodYear: number }>,
  year: number,
): readonly NewerYear[] {
  const newest = new Map<KpiKey, number>();
  for (const row of rows) {
    if (!isKpiKey(row.kpiKey)) continue;
    const current = newest.get(row.kpiKey);
    if (current === undefined || row.periodYear > current) newest.set(row.kpiKey, row.periodYear);
  }
  return [...newest].flatMap(([key, newestYear]) =>
    newestYear > year ? [{ key, year: newestYear }] : [],
  );
}
