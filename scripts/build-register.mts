/**
 * Builds the public expert register (spec 0009 follow-up, expert directory) from the SGAS ASA
 * register extract:
 *
 *   pnpm register:build <extract.json>
 *
 * The extract is the raw register: name, address, postcode and place, country, phone, capacity,
 * email, website and the three continuing-education years. The published file keeps only what a
 * prospective client needs to judge coverage (name, place, canton, country, capacity, the three
 * years) and drops every direct contact detail: publishing 1,929 people's home addresses, private
 * mobile numbers and personal email addresses would be a disclosure the register's own purpose
 * does not carry, and no buyer needs it to see that the pool is deep. The canton comes from the
 * postcode through `CANTON_RANGES`; a row whose place carries no Swiss postcode keeps a null
 * canton and is counted under "not given". Plain Node, run by hand when a new extract lands;
 * the output is committed as `src/features/marketing/register.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** One row of the raw extract, in the register's own column order. */
export type RawRow = readonly [
  name: string,
  address: string,
  place: string,
  country: string,
  phone: string,
  capacity: string,
  email: string,
  website: string,
  year2026: string,
  year2025: string,
  year2024: string,
];

/** The declared capacity of a registered specialist. */
export type Capacity = "v" | "t" | "n" | "u";
/** The continuing-education status of one year. */
export type Status = "A" | "T" | "N" | "E" | "U";

/** One published entry: no address, no phone, no email, no website. */
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

/**
 * Swiss postcode blocks and their canton, in the order they are tested. The blocks follow the
 * official NPA allocation; where one block spans two cantons it is split at the real boundary
 * (1200 to 1252 is Geneva, 1260 upwards is Vaud again). Coarse by design: the page groups by
 * canton, so a commune on a border costs nothing.
 */
export const CANTON_RANGES: readonly (readonly [number, number, string])[] = [
  [1000, 1199, "VD"],
  [1200, 1252, "GE"],
  [1253, 1299, "VD"],
  [1300, 1499, "VD"],
  [1500, 1599, "FR"],
  [1600, 1618, "FR"],
  [1619, 1629, "VD"],
  [1630, 1699, "FR"],
  [1700, 1799, "FR"],
  [1800, 1869, "VD"],
  [1870, 1899, "VS"],
  [1900, 1999, "VS"],
  [2000, 2499, "NE"],
  [2500, 2799, "BE"],
  [2800, 2999, "JU"],
  [3000, 3899, "BE"],
  [3900, 3999, "VS"],
  [4000, 4099, "BS"],
  [4100, 4299, "BL"],
  [4300, 4399, "AG"],
  [4400, 4499, "BL"],
  [4500, 4799, "SO"],
  [4800, 4899, "AG"],
  [4900, 4999, "BE"],
  [5000, 5999, "AG"],
  [6000, 6299, "LU"],
  [6300, 6399, "ZG"],
  [6400, 6449, "SZ"],
  [6450, 6499, "UR"],
  [6500, 6999, "TI"],
  [7000, 7999, "GR"],
  [8000, 8199, "ZH"],
  [8200, 8299, "SH"],
  [8300, 8499, "ZH"],
  [8500, 8599, "TG"],
  [8600, 8799, "ZH"],
  [8800, 8899, "SZ"],
  [8900, 8999, "ZH"],
  [9000, 9099, "SG"],
  [9100, 9199, "AR"],
  [9200, 9999, "SG"],
];

/** The canton of a Swiss postcode, or null when it falls in no block. Pure. */
export function cantonOfPostcode(postcode: number): string | null {
  const block = CANTON_RANGES.find(([from, to]) => postcode >= from && postcode <= to);
  return block ? block[2] : null;
}

/**
 * The four digit postcode a place field carries, or null. The register's place column is typed
 * by hand, so the postcode may sit anywhere in it, may carry a `CH-` prefix and may be followed
 * by the town or preceded by it. Pure.
 */
export function postcodeOf(place: string): number | null {
  const match = place.match(/(?:CH-)?\b(\d{4})\b/);
  return match?.[1] ? Number(match[1]) : null;
}

/** The town of a place field, with the postcode and any `CH-` prefix removed. Pure. */
export function townOf(place: string): string {
  return place
    .replace(/(?:CH-)?\b\d{4,5}\b/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[,\s-]+|[,\s-]+$/g, "")
    .trim();
}

/** The capacity letter, mapping the register's `?` to `u` so the value is always a known key. Pure. */
export function capacityOf(raw: string): Capacity {
  return raw === "v" || raw === "t" || raw === "n" ? raw : "u";
}

/** The status letter of one year, defaulting to "not recorded" for an unknown value. Pure. */
export function statusOf(raw: string): Status {
  return raw === "A" || raw === "T" || raw === "N" || raw === "U" ? raw : "E";
}

/**
 * One published entry from one raw row: the contact columns are dropped, the canton is derived
 * from the postcode and the town keeps only its name. A row is Swiss when it says so or when it
 * carries no country at all, which the register uses for most Swiss entries. Pure.
 */
export function toEntry(row: RawRow): RegisterEntry {
  const place = row[2].trim();
  const declared = row[3].trim();
  const country = declared === "" ? "Schweiz" : declared;
  const postcode = country === "Schweiz" ? postcodeOf(place) : null;
  return [
    row[0].trim(),
    townOf(place),
    postcode === null ? "" : (cantonOfPostcode(postcode) ?? ""),
    country,
    capacityOf(row[5].trim()),
    statusOf(row[8].trim()),
    statusOf(row[9].trim()),
    statusOf(row[10].trim()),
  ];
}

/** Every entry, sorted by name so the published file has a stable order. Pure. */
export function toRegister(rows: readonly RawRow[]): readonly RegisterEntry[] {
  return rows.map(toEntry).toSorted((left, right) => left[0].localeCompare(right[0], "de"));
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "features", "marketing", "register.json");

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const source = process.argv[2];
  if (source) {
    const rows = JSON.parse(readFileSync(source, "utf8")) as RawRow[];
    const register = toRegister(rows);
    writeFileSync(OUT, `${JSON.stringify(register)}\n`);
    const withCanton = register.filter((entry) => entry[2] !== "").length;
    console.log(`${register.length} entries, ${withCanton} with a canton → ${OUT}`);
  }
}
