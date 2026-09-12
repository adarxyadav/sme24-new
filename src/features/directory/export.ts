/**
 * The pure rules of the unlocks CSV export (spec 0018, AC-13): RFC 4180 quoting, the formula
 * guard, the column order and the file name. Shared by the route handler and its test.
 */

/** The columns in order; each is a `directory.export.columns.<column>` key in both catalogs. */
export const EXPORT_COLUMNS = [
  "company",
  "country",
  "city",
  "firstName",
  "lastName",
  "title",
  "email",
  "phone",
  "mobile",
  "unlockedAt",
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

/**
 * One cell: a leading `=`, `+`, `-` or `@` is prefixed with a single quote so a spreadsheet never
 * runs it as a formula, then the value is quoted when it holds a quote, a comma or a line break,
 * with quotes doubled (RFC 4180). Pure.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replaceAll('"', '""')}"` : guarded;
}

/** One line of cells, CRLF terminated as RFC 4180 asks. Pure. */
export function csvLine(cells: readonly string[]): string {
  return `${cells.map(csvCell).join(",")}\r\n`;
}

/** `sme24-directory-unlocks-<yyyy-mm-dd>.csv`, the date on the Europe/Zurich clock. Pure. */
export function exportFileName(now: Date): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `sme24-directory-unlocks-${day}.csv`;
}
