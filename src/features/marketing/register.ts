import raw from "./register.json";

/**
 * The public expert directory (spec 0009 follow-up): the SGAS ASA register of Swiss occupational
 * safety specialists together with the PSM/MOC list of globally distributed specialists, reduced
 * to what a prospective client needs to judge the depth of the pool. `scripts/build-register.mts`
 * writes `register.json` from both sources and drops every direct contact detail and every
 * surname, so nothing here can leak an address, a phone number, a private email address or a
 * person's full name. Pure data and pure functions; the page reads them on the server and the
 * filter component reads the same shapes in the browser.
 */

/** A competency level, or "" for a specialist whose source does not record one. */
export const LEVELS = ["practitioner", "sme"] as const;
export type Level = (typeof LEVELS)[number];
/** The stored level, which may be absent. */
export type StoredLevel = Level | "";

/**
 * The titles the directory publishes, one per entry. "specialist" is not a competency rating: it
 * is what an entry carrying no PSM/MOC rating publishes, and it names the registration its source
 * does attest. See `titleOf`.
 */
export const TITLES = ["specialist", "practitioner", "sme"] as const;
export type Title = (typeof TITLES)[number];

/** One published entry, in the column order `register.json` stores. */
export type RegisterEntry = readonly [
  name: string,
  location: string,
  psm: StoredLevel,
  moc: StoredLevel,
];

/** The date the SGAS register was read, shown as the provenance line. */
export const EXTRACTED_ON = "2026-08-31";

/** Where the SGAS register is published, cited beside every count. */
export const REGISTER_SOURCE = "https://www.sgas.ch/de/sgasregister";

/** Every published entry, sorted by name. */
export const REGISTER = raw as unknown as readonly RegisterEntry[];

/** One location and how many specialists sit in it. */
export type LocationCount = { readonly location: string; readonly count: number };

/**
 * How many entries sit in each location, most first, with entries carrying no location excluded.
 * The filter offers these, so a reader can narrow to a country before reading any name. Pure.
 */
export function locationCounts(
  entries: readonly RegisterEntry[] = REGISTER,
): readonly LocationCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry[1] === "") continue;
    counts.set(entry[1], (counts.get(entry[1]) ?? 0) + 1);
  }
  return [...counts]
    .map(([location, count]) => ({ location, count }))
    .toSorted(
      (left, right) => right.count - left.count || left.location.localeCompare(right.location),
    );
}

/**
 * How many entries carry a competency level at all, which is what separates the PSM/MOC half of
 * the directory from the SGAS half. Pure.
 */
export function ratedCount(entries: readonly RegisterEntry[] = REGISTER): number {
  return entries.filter((entry) => entry[2] !== "" || entry[3] !== "").length;
}

/** How many entries hold the given level in either competency. Pure. */
export function atLevel(level: Level, entries: readonly RegisterEntry[] = REGISTER): number {
  return entries.filter((entry) => entry[2] === level || entry[3] === level).length;
}

/**
 * The one title an entry publishes, merged from the two competency ratings its source records.
 *
 * The sources rate in two disciplines (process safety and management of change) but a reader
 * scanning for depth wants one answer per person, so the higher of the two wins and the
 * discipline is not shown: "SME in something" is the question the column answers. No entry
 * carries exactly one rating -- the PSM/MOC half of the directory rates both disciplines or
 * neither -- so the merge never has to choose between a rating and a blank.
 *
 * An entry the SGAS register contributes carries no PSM/MOC rating at all, which is a different
 * thing from a low one: that register attests Swiss safety specialist registration and grades
 * nothing. Those entries publish "specialist", and the catalog word for it says exactly that,
 * so no cell claims a competency rating its source never granted. Pure.
 */
export function titleOf(entry: RegisterEntry): Title {
  if (entry[2] === "sme" || entry[3] === "sme") return "sme";
  if (entry[2] === "practitioner" || entry[3] === "practitioner") return "practitioner";
  return "specialist";
}

/** The filters the directory applies, all optional and all independent. */
export type RegisterFilters = {
  /** A case insensitive substring of the name or the location. */
  readonly query: string;
  /** A location, or "" for every location. */
  readonly location: string;
  /** A published title, or "" for every title. */
  readonly level: string;
};

/** The empty filter set: what the page renders before anyone types. */
export const NO_FILTERS: RegisterFilters = { query: "", location: "", level: "" };

/**
 * The entries a filter set selects, in the register's own order. The query matches the name and
 * the location, which is what someone checking "is there anyone near us" actually types. The
 * level matches the title the row publishes, not the ratings behind it: the table shows one
 * merged title per row, and a filter reading the columns underneath would return a row whose
 * visible title disagrees with the filter that found it. Pure, and fast enough on the full list
 * to run on every keystroke without a worker or an index.
 */
export function filterRegister(
  entries: readonly RegisterEntry[],
  filters: RegisterFilters,
): readonly RegisterEntry[] {
  const query = filters.query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (filters.location !== "" && entry[1] !== filters.location) return false;
    if (filters.level !== "" && titleOf(entry) !== filters.level) return false;
    if (query === "") return true;
    return entry[0].toLowerCase().includes(query) || entry[1].toLowerCase().includes(query);
  });
}
