import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RETENTION } from "@/features/legal/processors";

/**
 * The record of processing (spec 0015, AC-16). The pgTAP file proves its table list equals the
 * schema's, which needs the live stack; this test proves the list pgTAP checks is the list the
 * document actually publishes, so the chain document -> pgTAP -> schema has no gap. It also keeps
 * every table the privacy page names present in the record, because a period stated on the page
 * and absent from the record is exactly the drift the record exists to prevent.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const DOCUMENT = readFileSync(join(ROOT, "docs", "legal", "record-of-processing.md"), "utf8");
const PGTAP = readFileSync(
  join(ROOT, "supabase", "tests", "record_of_processing.test.sql"),
  "utf8",
);

/** The tables of the document's main table: the first cell of each row, written as `\`name\``. */
function documentedTables(): readonly string[] {
  const rows = DOCUMENT.split("\n").filter((line) => line.startsWith("| `"));
  return (
    rows
      .map((line) => line.split("|")[1]?.trim() ?? "")
      .map((cell) => cell.replace(/`/g, ""))
      // The "Data outside Postgres" table also starts its rows with a backticked cell; its entries
      // are buckets and external systems, which carry a space or a dot and are not schema tables.
      .filter((name) => /^[a-z_]+$/.test(name))
      .sort()
  );
}

/** The tables the pgTAP file lists in `pg_temp.documented_tables()`. */
function pgTapTables(): readonly string[] {
  const block = PGTAP.slice(
    PGTAP.indexOf("returns table (name text) language sql as $$"),
    PGTAP.indexOf("-- Base tables only"),
  );
  return [...block.matchAll(/\('([a-z_]+)'\)/g)].map((match) => match[1] as string).sort();
}

describe("record of processing (AC-16)", () => {
  it("lists the same tables in the document and in the pgTAP file", () => {
    // pgTAP cannot read the markdown (`supabase test db` runs SQL with no filesystem access), so
    // this is what stops the embedded list going stale against the document it stands for.
    expect(pgTapTables()).toEqual(documentedTables());
  });

  it("documents every table the privacy page states a period for", () => {
    const documented = new Set(documentedTables());
    for (const row of RETENTION) {
      // `enquiries_ip_hash` is a column of `enquiries`, given its own row on the page because it
      // has its own period; the record covers it in the `enquiries` row.
      const table = row.table === "enquiries_ip_hash" ? "enquiries" : row.table;
      expect(documented.has(table), table).toBe(true);
    }
  });

  it("names a legal basis and a retention code for every documented table", () => {
    const rows = DOCUMENT.split("\n").filter((line) => /^\| `[a-z_]+` \|/.test(line));
    expect(rows.length).toBe(documentedTables().length);
    for (const row of rows) {
      const cells = row.split("|").map((cell) => cell.trim());
      const [, table, , , basis, retention] = cells;
      expect(basis, `${table} basis`).toBeTruthy();
      expect(retention, `${table} retention`).toBeTruthy();
    }
  });
});
