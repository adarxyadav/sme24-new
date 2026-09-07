import raw from "./register.json";

/**
 * The public expert register (spec 0009 follow-up, expert directory): the SGAS ASA register of
 * occupational safety specialists, reduced to what a prospective client needs to judge the depth
 * of the pool. `scripts/build-register.mts` writes `register.json` from the raw extract and drops
 * every direct contact detail, so nothing here can leak an address, a phone number or a private
 * email address. Pure data and pure functions; the page reads them on the server and the filter
 * component reads the same shapes in the browser.
 */

/** The declared capacity of a registered specialist: available, partly, not, or not stated. */
export const CAPACITIES = ["v", "t", "n", "u"] as const;
export type Capacity = (typeof CAPACITIES)[number];

/** The continuing-education status of one year, as the register records it. */
export const STATUSES = ["A", "T", "N", "E", "U"] as const;
export type Status = (typeof STATUSES)[number];

/** One published entry, in the column order `register.json` stores. */
export type RegisterEntry = readonly [
  name: string,
  place: string,
  canton: string,
  country: string,
  capacity: Capacity,
  year2026: Status,
  year2025: Status,
  year2024: Status,
];

/** The date the register was read, shown as the provenance line. */
export const EXTRACTED_ON = "2026-08-31";

/** Where the register is published, cited beside every count. */
export const REGISTER_SOURCE = "https://www.sgas.ch/de/sgasregister";

/** Every published entry, sorted by name. */
export const REGISTER = raw as unknown as readonly RegisterEntry[];

/** The 26 cantons in the order the coverage table lists them: by count, resolved by the data. */
export type CantonCount = { readonly canton: string; readonly count: number };

/**
 * How many entries sit in each canton, most first, with the entries whose place carries no Swiss
 * postcode excluded. The page renders this as the coverage table, so a reader sees the depth per
 * region before any name. Pure.
 */
export function cantonCounts(entries: readonly RegisterEntry[] = REGISTER): readonly CantonCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry[2] === "") continue;
    counts.set(entry[2], (counts.get(entry[2]) ?? 0) + 1);
  }
  return [...counts]
    .map(([canton, count]) => ({ canton, count }))
    .toSorted((left, right) => right.count - left.count || left.canton.localeCompare(right.canton));
}

/** How many entries declare each capacity, in the fixed order of `CAPACITIES`. Pure. */
export function capacityCounts(
  entries: readonly RegisterEntry[] = REGISTER,
): Readonly<Record<Capacity, number>> {
  const counts: Record<Capacity, number> = { v: 0, t: 0, n: 0, u: 0 };
  for (const entry of entries) counts[entry[4]] += 1;
  return counts;
}

/** How many entries completed their continuing education in the given year column. Pure. */
export function completedIn(year: 5 | 6 | 7, entries: readonly RegisterEntry[] = REGISTER): number {
  return entries.filter((entry) => entry[year] === "A").length;
}

/** The filters the directory applies, all optional and all independent. */
export type RegisterFilters = {
  /** A case insensitive substring of the name or the town. */
  readonly query: string;
  /** A canton code, or "" for every canton. */
  readonly canton: string;
  /** A capacity letter, or "" for every capacity. */
  readonly capacity: string;
};

/** The empty filter set: what the page renders before anyone types. */
export const NO_FILTERS: RegisterFilters = { query: "", canton: "", capacity: "" };

/**
 * The entries a filter set selects, in the register's own order. The query matches the name and
 * the town, which is what someone checking "is there anyone near us" actually types. Pure, and
 * fast enough on 1,929 rows to run on every keystroke without a worker or an index.
 */
export function filterRegister(
  entries: readonly RegisterEntry[],
  filters: RegisterFilters,
): readonly RegisterEntry[] {
  const query = filters.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.canton !== "" && entry[2] !== filters.canton) return false;
    if (filters.capacity !== "" && entry[4] !== filters.capacity) return false;
    if (query === "") return true;
    return entry[0].toLowerCase().includes(query) || entry[1].toLowerCase().includes(query);
  });
}
