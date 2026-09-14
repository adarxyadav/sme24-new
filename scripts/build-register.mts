/**
 * Builds the public expert directory (spec 0009 follow-up) from two sources:
 *
 *   pnpm register:build <sgas-extract.json> [psm-moc.xlsx]
 *
 * The first is the SGAS ASA register of Swiss occupational safety specialists: name, address,
 * postcode and place, country, phone, capacity, email, website and three continuing-education
 * years. The second is the PSM/MOC list of globally distributed specialists: name, location and
 * a competency level for each of Process Safety Management and Management of Change.
 *
 * Both are reduced to the same five columns -- name, location, country, PSM level, MOC level --
 * and written as one sorted file. Everything else is dropped. From SGAS that means every direct
 * contact detail: publishing 1,929 people's home addresses, private mobile numbers and personal
 * email addresses would be a disclosure the register's own purpose does not carry, and no buyer
 * needs it to see that the pool is deep. It also now means the canton, the declared capacity and
 * the three years, which left the published shape when the directory went global (owner decision
 * of 2026-09-14): a Swiss canton does not describe a pool spanning 24 countries.
 *
 * NAMES ARE TRUNCATED TO THE FIRST TOKEN (owner decision of 2026-09-14) before anything is
 * written, so no surname from either source enters the committed file. `CANTON_RANGES` and the
 * postcode helpers are kept because the SGAS place column is still parsed for its town, and
 * because restoring the canton means restoring a call, not re-deriving a table.
 *
 * Plain Node, run by hand when a new extract lands; the output is committed as
 * `src/features/marketing/register.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

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

/** The declared capacity of a registered specialist. Parsed from SGAS, no longer published. */
export type Capacity = "v" | "t" | "n" | "u";
/** The continuing-education status of one year. Parsed from SGAS, no longer published. */
export type Status = "A" | "T" | "N" | "E" | "U";

/** A competency level in the PSM/MOC list, or "" for a specialist the list does not cover. */
export type Level = "" | "practitioner" | "sme";

/**
 * One published entry, shared by both sources: no address, no phone, no email, no website, no
 * surname. `location` is the country or region, so one column means one thing across a Swiss
 * town and a regional grouping like "LATAM"; `psm` and `moc` are empty for every SGAS row.
 */
export type RegisterEntry = readonly [name: string, location: string, psm: Level, moc: Level];

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
 * The given name of a name field (owner decision of 2026-09-14): the directory publishes a given
 * name and nothing else, so no surname from either source reaches the committed file. Applied in
 * the build rather than the page, because a page level truncation would still ship every surname
 * in the JSON.
 *
 * The two sources order their names differently and neither uses a comma to say so, so the order
 * is a property of the source rather than something a rule can read off one name. SGAS writes
 * "Surname Forename" ("Ababsa Adrien"), so the given name is the LAST token; the PSM/MOC list
 * writes "Forename Surname", so it is the FIRST. Getting this backwards publishes exactly the
 * half of each name the decision was meant to withhold, which is why `surnameFirst` is required
 * rather than defaulted.
 *
 * A middle name sits between the two in both orders and is dropped with the surname. A name of
 * one token is returned unchanged. Pure.
 */
export function givenNameOf(name: string, surnameFirst: boolean): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((token) => token !== "");
  if (tokens.length === 0) return "";
  return (surnameFirst ? tokens[tokens.length - 1] : tokens[0]) ?? "";
}

/**
 * German country names to the English the PSM/MOC list uses. The two sources name the same
 * country differently -- SGAS writes "Schweiz" and "Frankreich" where the global list writes
 * "Switzerland" and "France" -- so without this one country becomes two filter options splitting
 * its own people. English wins because it is the larger vocabulary of the two and the only one
 * the global half has; the column is a proper noun rather than a translated string, so it stays
 * the same in both catalogs.
 */
export const LOCATION_ALIASES: Readonly<Record<string, string>> = {
  Schweiz: "Switzerland",
  Frankreich: "France",
  Deutschland: "Germany",
  Italien: "Italy",
  Liechtenstein: "Liechtenstein",
  Westsahara: "Western Sahara",
};

/** One country name, in the single spelling the directory publishes. Pure. */
export function locationOf(raw: string): string {
  const value = raw.trim();
  return LOCATION_ALIASES[value] ?? value;
}

/** A PSM or MOC level from the list's own wording, unknown text falling back to "". Pure. */
export function levelOf(raw: string): Level {
  const value = raw.trim().toLowerCase();
  if (value === "practitioner") return "practitioner";
  if (value === "subject matter expert") return "sme";
  return "";
}

/**
 * One published entry from one SGAS row: the contact columns are dropped, the name is reduced to
 * its first token and the location is the country rather than the town, so the shared column does
 * not mix "Zürich" with "LATAM". A row is Swiss when it says so or when it carries no country at
 * all, which the register uses for most Swiss entries. The two competency columns are empty: the
 * SGAS register does not record PSM or MOC. Pure.
 */
export function toEntry(row: RawRow): RegisterEntry {
  const declared = row[3].trim();
  return [givenNameOf(row[0], true), locationOf(declared === "" ? "Schweiz" : declared), "", ""];
}

/** One published entry from one PSM/MOC row: the name reduced to its first token. Pure. */
export function toGlobalEntry(row: readonly string[]): RegisterEntry {
  return [
    givenNameOf(row[0] ?? "", false),
    locationOf(row[1] ?? ""),
    levelOf(row[2] ?? ""),
    levelOf(row[3] ?? ""),
  ];
}

/**
 * Every entry from both sources as one list, sorted by name so the published file has a stable
 * order. The two are concatenated rather than reconciled: a person appearing on both lists would
 * appear twice, which the sources give us no key to detect now that surnames are gone. Pure.
 */
export function toRegister(
  rows: readonly RawRow[],
  globalRows: readonly (readonly string[])[] = [],
): readonly RegisterEntry[] {
  return [...rows.map(toEntry), ...globalRows.map(toGlobalEntry)].toSorted((left, right) =>
    left[0].localeCompare(right[0], "de"),
  );
}

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "src", "features", "marketing", "register.json");

/**
 * The PSM/MOC rows of an xlsx, by column position rather than header name: the file's headers
 * carry spaced hyphens ("PSM - Level") that a rename would silently break. The header row is
 * skipped and a row with no name is dropped. Reads the file, so not pure.
 */
export async function readGlobalRows(path: string): Promise<readonly (readonly string[])[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];
  const rows: string[][] = [];
  for (let index = 2; index <= sheet.rowCount; index += 1) {
    const row = sheet.getRow(index);
    const cells = [1, 2, 3, 4].map((column) => {
      const value = row.getCell(column).value;
      return value === null || value === undefined ? "" : String(value).trim();
    });
    if (cells[0] !== "") rows.push(cells);
  }
  return rows;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const source = process.argv[2];
  const globalSource = process.argv[3];
  if (source) {
    const rows = JSON.parse(readFileSync(source, "utf8")) as RawRow[];
    const globalRows = globalSource ? await readGlobalRows(globalSource) : [];
    const register = toRegister(rows, globalRows);
    writeFileSync(OUT, `${JSON.stringify(register)}\n`);
    const rated = register.filter((entry) => entry[2] !== "" || entry[3] !== "").length;
    console.log(
      `${register.length} entries (${rows.length} SGAS, ${globalRows.length} PSM/MOC), ${rated} with a competency level → ${OUT}`,
    );
  }
}
