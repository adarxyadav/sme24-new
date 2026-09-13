import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSUMPTION_KEYS, PEER_YEARS_BACK } from "@/features/benchmark/catalogue";
import {
  formatTimestamp,
  migrationTimestamp,
  nextMigrationTimestamp,
  renderAssumptionUpsert,
  renderBenchmarkUpsert,
  renderPeerCompanyUpsert,
  renderPeerFigureUpsert,
  renderPeerRetirement,
  renderSeedMigration,
} from "@/features/benchmark/seed-migration";
import {
  assumptionFileSchema,
  assumptionRowSchema,
  benchmarkRowSchema,
  checkPeerFiles,
  parseCsv,
  parseSeedRows,
  peerCompanyRowSchema,
  peerFigureRowSchema,
  publishedValueOf,
} from "@/features/benchmark/seed-schema";

const SEED_DIR = join(process.cwd(), "supabase/seed-data");
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const BENCHMARK_HEADER =
  "kpi_key,industry_section,size_band,period_year,p25,median,p75,sample_size,source_name,source_url,source_note_de,source_note_en,source_key,basis_de,basis_en,provisional,is_assumption";
const ASSUMPTION_HEADER =
  "key,value,unit,label_de,label_en,source_name,source_url,note_de,note_en,provisional,is_assumption,effective_from";

function assumptionLine(key: string, value: number): string {
  return `${key},${value},unit,Label,Label,Source,,,,true,false,2026-01-01`;
}

describe("the CSV parser (spec 0008, AC-2)", () => {
  it("reads quoted fields with commas, doubled quotes and line breaks and keeps line numbers", () => {
    const table = parseCsv('a,b\n1,"x, y"\n2,"say ""hi""\nagain"\n3,plain\n');
    expect(table.header).toEqual(["a", "b"]);
    expect(table.records.map((record) => record.fields)).toEqual([
      { a: "1", b: "x, y" },
      { a: "2", b: 'say "hi"\nagain' },
      { a: "3", b: "plain" },
    ]);
    expect(table.records.map((record) => record.line)).toEqual([2, 3, 5]);
  });

  it("names the line of a row with the wrong number of fields", () => {
    expect(() => parseCsv("a,b\n1,2\n3\n")).toThrow("line 3");
  });
});

describe("the seed row schemas (spec 0008, AC-2)", () => {
  it("rejects a row with p25 above the median with its line number", () => {
    const table = parseCsv(
      `${BENCHMARK_HEADER}\nltifr,C,all,2022,1,2,3,,Source,,,,,,,true,false\nltifr,ALL,all,2022,3,2,4,,Source,,,,,,,true,false\n`,
    );
    const result = parseSeedRows(table, benchmarkRowSchema);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.line).toBe(3);
      expect(result.error.message).toContain("p25 <= median <= p75");
    }
  });

  it("rejects an unknown section, band, year and a broken url", () => {
    const bad = (line: string) =>
      parseSeedRows(parseCsv(`${BENCHMARK_HEADER}\n${line}\n`), benchmarkRowSchema).ok;
    expect(bad("ltifr,X,all,2022,1,2,3,,Source,,,,,,,true,false")).toBe(false);
    expect(bad("ltifr,C,huge,2022,1,2,3,,Source,,,,,,,true,false")).toBe(false);
    expect(bad("ltifr,C,all,1999,1,2,3,,Source,,,,,,,true,false")).toBe(false);
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,not a url,,,,,,true,false")).toBe(false);
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,,only de,,,,,true,false")).toBe(false);
    // basis, like source_note, is both locales or neither (spec 0016, AC-1).
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,,,,,nur de,,true,false")).toBe(false);
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,,,,,,only en,true,false")).toBe(false);
    // A value is either awaiting a reading or declared unsourceable, never both (spec 0016, AC-2).
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,,,,,,,true,true")).toBe(false);
    expect(
      bad(
        "ltifr,C,all,2022,1,2,3,12,Source,https://example.org,de,en,Suva class 22A,Basis de,Basis en,false,false",
      ),
    ).toBe(true);
  });

  it("requires every assumption key exactly once and the multipliers in order", () => {
    const rows = (values: Partial<Record<(typeof ASSUMPTION_KEYS)[number], number>>) => {
      const lines = ASSUMPTION_KEYS.filter((key) => values[key] !== undefined).map((key) =>
        assumptionLine(key, values[key] as number),
      );
      const parsed = parseSeedRows(
        parseCsv(`${ASSUMPTION_HEADER}\n${lines.join("\n")}\n`),
        assumptionRowSchema,
      );
      if (!parsed.ok) throw new Error(parsed.error.message);
      return assumptionFileSchema.safeParse(parsed.rows);
    };
    const complete = {
      hours_per_fte: 1800,
      direct_cost_per_case_chf: 5000,
      cost_per_absence_day_chf: 1000,
      lost_days_per_incident_default: 10,
      indirect_multiplier_low: 2,
      indirect_multiplier: 3,
      indirect_multiplier_high: 5,
    };
    expect(rows(complete).success).toBe(true);
    const { hours_per_fte: _missing, ...withoutHours } = complete;
    const missing = rows(withoutHours);
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.message).toContain("exactly once");
    const disordered = rows({ ...complete, indirect_multiplier_low: 4 });
    expect(disordered.success).toBe(false);
    expect(disordered.error?.issues[0]?.message).toContain("indirect_multiplier_low <=");
  });

  it("parses the committed CSVs with the two flags (spec 0016, AC-1, AC-2)", () => {
    const benchmarks = parseSeedRows(
      parseCsv(readFileSync(join(SEED_DIR, "benchmarks.csv"), "utf8")),
      benchmarkRowSchema,
    );
    expect(benchmarks.ok).toBe(true);
    if (benchmarks.ok) {
      expect(benchmarks.rows.length).toBeGreaterThan(0);
      // Every peer row has been read from its named source (spec 0016 amendment, AC-24 to AC-28).
      expect(benchmarks.rows.every((row) => !row.provisional)).toBe(true);
      expect(benchmarks.rows.every((row) => row.source_key && row.basis_de && row.basis_en)).toBe(
        true,
      );
      // No Suva row claims a sample size: its branches are not peers (AC-24).
      expect(
        benchmarks.rows
          .filter((row) => row.kpi_key === "accident_rate_per_1000_fte")
          .every((row) => row.sample_size === null),
      ).toBe(true);
      expect(
        benchmarks.rows.some(
          (row) =>
            row.kpi_key === "accident_rate_per_1000_fte" &&
            row.industry_section === "ALL" &&
            row.size_band === "all",
        ),
      ).toBe(true);
      // No seeded peer row is a declared assumption (spec 0016, AC-2).
      expect(benchmarks.rows.every((row) => !row.is_assumption)).toBe(true);
    }
    const assumptions = parseSeedRows(
      parseCsv(readFileSync(join(SEED_DIR, "benchmark-assumptions.csv"), "utf8")),
      assumptionRowSchema,
    );
    expect(assumptions.ok).toBe(true);
    if (assumptions.ok) {
      expect(assumptionFileSchema.safeParse(assumptions.rows).success).toBe(true);
      // The three multipliers are declared assumptions, because no Swiss indirect to direct
      // accident cost ratio is published; the other four still await their reading (AC-2).
      const multipliers = [
        "indirect_multiplier_low",
        "indirect_multiplier",
        "indirect_multiplier_high",
      ];
      const isMultiplier = (key: string) => multipliers.includes(key);
      expect(
        assumptions.rows
          .filter((row) => isMultiplier(row.key))
          .every((row) => row.is_assumption && !row.provisional),
      ).toBe(true);
      expect(
        assumptions.rows
          .filter((row) => !isMultiplier(row.key))
          .every((row) => row.provisional && !row.is_assumption),
      ).toBe(true);
      // AC-10: each multiplier states its source and that no Swiss ratio is published.
      expect(
        assumptions.rows
          .filter((row) => isMultiplier(row.key))
          .every((row) => (row.note_en ?? "").length > 0 && (row.note_de ?? "").length > 0),
      ).toBe(true);
    }
  });
});

describe("the seed migration generator (spec 0008, AC-2)", () => {
  it("renders one upsert per row with doubled quotes and jsonb notes", () => {
    const table = parseCsv(
      `${BENCHMARK_HEADER}\nltifr,C,all,2022,1,2,3,12,"O'Reilly",https://example.org,"Anmerkung, de",Note en,Suva 22A,"Grundlage, de",Basis en,true,false\n`,
    );
    const rows = parseSeedRows(table, benchmarkRowSchema);
    if (!rows.ok) throw new Error(rows.error.message);
    const sql = renderBenchmarkUpsert(rows.rows[0] as NonNullable<(typeof rows.rows)[0]>);
    expect(sql).toContain("insert into public.benchmarks");
    expect(sql).toContain("'O''Reilly'");
    expect(sql).toContain('{"de":"Anmerkung, de","en":"Note en"}');
    // The two source columns and the flag reach the upsert (spec 0016, AC-1).
    expect(sql).toContain("'Suva 22A'");
    expect(sql).toContain('{"de":"Grundlage, de","en":"Basis en"}');
    expect(sql).toContain("is_assumption");
    expect(sql).toContain(
      "on conflict (kpi_key, industry_section, size_band, period_year) do update set",
    );
    expect(sql).not.toMatch(/do update set[^;]*kpi_key = excluded/);
  });

  // The CSV is the whole peer table (spec 0016 amendment, AC-29): a reading replaced under a new
  // period year would otherwise stay in the table beside the new row and trip the launch gate.
  it("retires every peer row the CSV no longer names, and nothing when the CSV is empty", () => {
    const rows = parseSeedRows(
      parseCsv(
        `${BENCHMARK_HEADER}\nltifr,C,all,2024,1,2,3,,Source,,,,,,,false,false\nltifr,ALL,all,2023,1,2,3,,Source,,,,,,,false,false\n`,
      ),
      benchmarkRowSchema,
    );
    if (!rows.ok) throw new Error(rows.error.message);
    const sql = renderSeedMigration(rows.rows, [], new Date("2026-09-12T09:00:00Z"));
    expect(sql).toContain(
      "delete from public.benchmarks where (kpi_key, industry_section, size_band, period_year) not in (",
    );
    expect(sql).toContain("('ltifr', 'C', 'all', 2024)");
    expect(sql).toContain("('ltifr', 'ALL', 'all', 2023)");
    // The delete follows the upserts, so the new rows are in place before anything is retired.
    expect(sql.indexOf("delete from public.benchmarks")).toBeGreaterThan(
      sql.lastIndexOf("insert into public.benchmarks"),
    );
    expect(renderSeedMigration([], [], new Date("2026-09-12T09:00:00Z"))).not.toContain(
      "delete from",
    );
  });

  it("renders an assumption upsert keyed by key", () => {
    const parsed = parseSeedRows(
      parseCsv(`${ASSUMPTION_HEADER}\n${assumptionLine("hours_per_fte", 1804)}\n`),
      assumptionRowSchema,
    );
    if (!parsed.ok) throw new Error(parsed.error.message);
    const sql = renderAssumptionUpsert(parsed.rows[0] as NonNullable<(typeof parsed.rows)[0]>);
    expect(sql).toContain("insert into public.benchmark_assumptions");
    expect(sql).toContain("on conflict (key) do update set value = excluded.value");
    expect(sql).toContain("'2026-01-01'");
  });

  it("writes a timestamp strictly later than the newest migration", () => {
    const files = [
      "20260906001341_research_pipeline.sql",
      "20260906073200_peer_benchmark.sql",
      "README",
    ];
    expect(migrationTimestamp("20260906073200_peer_benchmark.sql")).toBe("20260906073200");
    expect(migrationTimestamp("README")).toBeNull();
    expect(nextMigrationTimestamp(files, new Date("2026-09-06T09:00:00Z"))).toBe("20260906090000");
    expect(nextMigrationTimestamp(files, new Date("2026-09-06T07:32:00Z"))).toBe("20260906073201");
    expect(nextMigrationTimestamp(files, new Date("2026-09-01T00:00:00Z"))).toBe("20260906073201");
    expect(nextMigrationTimestamp([], new Date("2026-09-06T09:00:00Z"))).toBe("20260906090000");
    expect(formatTimestamp(new Date("2026-12-31T23:59:59Z"))).toBe("20261231235959");
  });

  it("renders a whole migration with a header and both blocks", () => {
    const sql = renderSeedMigration([], [], new Date("2026-09-06T09:00:00Z"));
    expect(sql).toContain("pnpm benchmarks:migration");
    expect(sql).toContain("0 peer rows");
    expect(sql).toContain("0 assumptions");
  });

  it("has a committed seed migration that follows the table migration", () => {
    const files = readdirSync(MIGRATIONS_DIR).sort();
    const table = files.find((file) => file.endsWith("_peer_benchmark.sql"));
    const seed = files.find((file) => file.endsWith("_benchmark_seed.sql"));
    expect(table).toBeTruthy();
    expect(seed).toBeTruthy();
    expect(
      (migrationTimestamp(seed as string) as string) >
        (migrationTimestamp(table as string) as string),
    ).toBe(true);
    const sql = readFileSync(join(MIGRATIONS_DIR, seed as string), "utf8");
    for (const key of ASSUMPTION_KEYS) expect(sql).toContain(`'${key}'`);
  });
});

const PEER_COMPANY_HEADER =
  "key,name,country,industry_section,headcount,headcount_year,report_url,note_de,note_en";
const PEER_FIGURE_HEADER =
  "peer_key,kpi_key,period_year,value_as_published,unit_as_published,basis,source_url,verified_at,verified_by";

function companies(lines: readonly string[]) {
  const parsed = parseSeedRows(
    parseCsv(`${PEER_COMPANY_HEADER}\n${lines.join("\n")}\n`),
    peerCompanyRowSchema,
  );
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.rows;
}
function figures(lines: readonly string[]) {
  return parseSeedRows(
    parseCsv(`${PEER_FIGURE_HEADER}\n${lines.join("\n")}\n`),
    peerFigureRowSchema,
  );
}

/**
 * The peer library seed path (spec 0021, AC-3, AC-13): the unit conversion at seed time, the
 * refusals with a line number, the cross file rules with a frozen year, the rendered upserts and
 * the retirement, and the committed files inside the freshness window.
 */
describe("the peer seed schemas (spec 0021, AC-3, AC-13)", () => {
  it("converts a per 200 000 hours figure times five, keeps the rest, and refuses an unknown unit", () => {
    expect(publishedValueOf(3.2, "per_200k_hours")).toBe(16);
    expect(publishedValueOf(2.4, "per_million_hours")).toBe(2.4);
    expect(publishedValueOf(12.5, "days")).toBe(12.5);
    expect(publishedValueOf(1, "boolean")).toBe(1);
    expect(publishedValueOf(0.5, "boolean")).toBeNull();
    expect(publishedValueOf(1, "per_hour")).toBeNull();
    const parsed = figures([
      "acme,ltifr,2024,3.2,per_200k_hours,employees,https://example.org/r,2026-09-13,A. Curator",
    ]);
    expect(parsed.ok && parsed.rows[0]?.value).toBe(16);
    expect(parsed.ok && parsed.rows[0]?.value_as_published).toBe(3.2);
  });

  it("refuses a verified_at without a verified_by and the reverse, a KPI outside the four and a unit that does not fit the KPI, with the line", () => {
    const bad = (line: string) => {
      const parsed = figures([
        "acme,ltifr,2024,1,per_million_hours,employees,https://example.org/r,,",
        line,
      ]);
      return parsed.ok ? null : parsed.error.line;
    };
    expect(
      bad("acme,ltifr,2024,1,per_million_hours,employees,https://example.org/r,2026-09-13,"),
    ).toBe(3);
    expect(
      bad("acme,ltifr,2024,1,per_million_hours,employees,https://example.org/r,,A. Curator"),
    ).toBe(3);
    expect(bad("acme,fatalities,2024,1,per_million_hours,employees,https://example.org/r,,")).toBe(
      3,
    );
    expect(bad("acme,ltifr,2024,1,days,employees,https://example.org/r,,")).toBe(3);
    expect(
      bad("acme,iso_45001_certified,2024,1,per_million_hours,employees,https://example.org/r,,"),
    ).toBe(3);
    expect(
      bad("acme,lost_days_per_incident,2024,1,per_million_hours,employees,https://example.org/r,,"),
    ).toBe(3);
    expect(bad("acme,ltifr,2024,1,per_million_hours,everyone,https://example.org/r,,")).toBe(3);
    expect(bad("acme,ltifr,2024,1,per_million_hours,employees,not a url,,")).toBe(3);
    expect(
      bad("acme,trifr,2024,1,per_million_hours,employees_and_contractors,https://example.org/r,,"),
    ).toBeNull();
  });

  it("refuses a figure of an unknown company, a future year and a company without a figure, naming the file and line", () => {
    const acme = companies(["acme,Acme AG,CH,C,500,2024,https://example.org,,"]);
    const rows = (lines: readonly string[]) => {
      const parsed = figures(lines);
      if (!parsed.ok) throw new Error(parsed.error.message);
      return parsed.rows;
    };
    const ok = rows(["acme,ltifr,2024,1,per_million_hours,employees,https://example.org/r,,"]);
    expect(checkPeerFiles(acme, ok, 2026)).toBeNull();
    expect(
      checkPeerFiles(
        acme,
        rows(["ghost,ltifr,2024,1,per_million_hours,employees,https://example.org/r,,"]),
        2026,
      ),
    ).toMatchObject({ file: "peer-figures.csv", line: 2 });
    expect(
      checkPeerFiles(
        acme,
        rows(["acme,ltifr,2027,1,per_million_hours,employees,https://example.org/r,,"]),
        2026,
      ),
    ).toMatchObject({
      file: "peer-figures.csv",
      line: 2,
      message: expect.stringContaining("2027"),
    });
    expect(
      checkPeerFiles(
        companies([
          "acme,Acme AG,CH,C,500,2024,https://example.org,,",
          "idle,Idle AG,CH,C,500,2024,https://example.org,,",
        ]),
        ok,
        2026,
      ),
    ).toMatchObject({ file: "peer-companies.csv", line: 3 });
  });

  it("renders the upserts on both tables and the retirement, figures first", () => {
    const [acme] = companies(["acme,Acme AG,CH,C,500,2024,https://example.org,Notiz,Note"]);
    const parsed = figures([
      "acme,ltifr,2024,3.2,per_200k_hours,employees,https://example.org/r,2026-09-13,O'Brien",
    ]);
    if (!parsed.ok || !acme) throw new Error("fixture");
    const [figure] = parsed.rows;
    if (!figure) throw new Error("fixture");
    const companySql = renderPeerCompanyUpsert(acme);
    expect(companySql).toContain("insert into public.peer_companies (key, name, country");
    expect(companySql).toContain(`'{"de":"Notiz","en":"Note"}'::jsonb`);
    expect(companySql).toContain("on conflict (key) do update set name = excluded.name");
    const figureSql = renderPeerFigureUpsert(figure);
    expect(figureSql).toContain(
      "values ('acme', 'ltifr', 2024, 16, 3.2, 'per_200k_hours', 'employees'",
    );
    expect(figureSql).toContain("'2026-09-13'::timestamptz, 'O''Brien'");
    expect(figureSql).toContain(
      "on conflict (peer_key, kpi_key, period_year, basis) do update set value = excluded.value",
    );
    const retirement = renderPeerRetirement([acme], parsed.rows) ?? "";
    expect(retirement.indexOf("delete from public.peer_figures")).toBeLessThan(
      retirement.indexOf("delete from public.peer_companies"),
    );
    expect(retirement).toContain("('acme', 'ltifr', 2024, 'employees')");
    expect(retirement).toContain("where key not in ('acme')");
    expect(renderPeerRetirement([], [])).toBeNull();
  });

  it("parses the committed peer CSVs, every figure verified and inside the freshness window on the day the seed was written (AC-4)", () => {
    const companyRows = parseSeedRows(
      parseCsv(readFileSync(join(SEED_DIR, "peer-companies.csv"), "utf8")),
      peerCompanyRowSchema,
    );
    const figureRows = parseSeedRows(
      parseCsv(readFileSync(join(SEED_DIR, "peer-figures.csv"), "utf8")),
      peerFigureRowSchema,
    );
    expect(companyRows.ok).toBe(true);
    expect(figureRows.ok).toBe(true);
    if (!companyRows.ok || !figureRows.ok) return;
    // The frozen clock: the year the seed was written.
    const SEED_YEAR = 2026;
    expect(checkPeerFiles(companyRows.rows, figureRows.rows, SEED_YEAR)).toBeNull();
    expect(figureRows.rows.every((row) => row.verified_at !== null)).toBe(true);
    expect(figureRows.rows.every((row) => row.period_year >= SEED_YEAR - PEER_YEARS_BACK)).toBe(
      true,
    );
    const inSection = (section: string) =>
      companyRows.rows.filter((row) => row.industry_section === section).map((row) => row.key);
    const ltifrIn = (section: string) =>
      figureRows.rows.filter(
        (row) => row.kpi_key === "ltifr" && inSection(section).includes(row.peer_key),
      );
    // The thin thread (milestone 1): three verified manufacturers with an LTIFR each.
    expect(ltifrIn("C").length).toBeGreaterThanOrEqual(3);
    expect(inSection("C").length).toBeGreaterThanOrEqual(3);
  });
});
