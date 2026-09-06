import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ASSUMPTION_KEYS } from "@/features/benchmark/catalogue";
import {
  formatTimestamp,
  migrationTimestamp,
  nextMigrationTimestamp,
  renderAssumptionUpsert,
  renderBenchmarkUpsert,
  renderSeedMigration,
} from "@/features/benchmark/seed-migration";
import {
  assumptionFileSchema,
  assumptionRowSchema,
  benchmarkRowSchema,
  parseCsv,
  parseSeedRows,
} from "@/features/benchmark/seed-schema";

const SEED_DIR = join(process.cwd(), "supabase/seed-data");
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");

const BENCHMARK_HEADER =
  "kpi_key,industry_section,size_band,period_year,p25,median,p75,sample_size,source_name,source_url,source_note_de,source_note_en,provisional";
const ASSUMPTION_HEADER =
  "key,value,unit,label_de,label_en,source_name,source_url,note_de,note_en,provisional,effective_from";

function assumptionLine(key: string, value: number): string {
  return `${key},${value},unit,Label,Label,Source,,,,true,2026-01-01`;
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
      `${BENCHMARK_HEADER}\nltifr,C,all,2022,1,2,3,,Source,,,,true\nltifr,ALL,all,2022,3,2,4,,Source,,,,true\n`,
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
    expect(bad("ltifr,X,all,2022,1,2,3,,Source,,,,true")).toBe(false);
    expect(bad("ltifr,C,huge,2022,1,2,3,,Source,,,,true")).toBe(false);
    expect(bad("ltifr,C,all,1999,1,2,3,,Source,,,,true")).toBe(false);
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,not a url,,,true")).toBe(false);
    expect(bad("ltifr,C,all,2022,1,2,3,,Source,,only de,,true")).toBe(false);
    expect(bad("ltifr,C,all,2022,1,2,3,12,Source,https://example.org,de,en,false")).toBe(true);
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

  it("parses the committed CSVs, every row provisional", () => {
    const benchmarks = parseSeedRows(
      parseCsv(readFileSync(join(SEED_DIR, "benchmarks.csv"), "utf8")),
      benchmarkRowSchema,
    );
    expect(benchmarks.ok).toBe(true);
    if (benchmarks.ok) {
      expect(benchmarks.rows.length).toBeGreaterThan(0);
      expect(benchmarks.rows.every((row) => row.provisional)).toBe(true);
      expect(
        benchmarks.rows.some(
          (row) =>
            row.kpi_key === "accident_rate_per_1000_fte" &&
            row.industry_section === "ALL" &&
            row.size_band === "all",
        ),
      ).toBe(true);
    }
    const assumptions = parseSeedRows(
      parseCsv(readFileSync(join(SEED_DIR, "benchmark-assumptions.csv"), "utf8")),
      assumptionRowSchema,
    );
    expect(assumptions.ok).toBe(true);
    if (assumptions.ok) {
      expect(assumptionFileSchema.safeParse(assumptions.rows).success).toBe(true);
      expect(assumptions.rows.every((row) => row.provisional)).toBe(true);
    }
  });
});

describe("the seed migration generator (spec 0008, AC-2)", () => {
  it("renders one upsert per row with doubled quotes and jsonb notes", () => {
    const table = parseCsv(
      `${BENCHMARK_HEADER}\nltifr,C,all,2022,1,2,3,12,"O'Reilly",https://example.org,"Anmerkung, de",Note en,true\n`,
    );
    const rows = parseSeedRows(table, benchmarkRowSchema);
    if (!rows.ok) throw new Error(rows.error.message);
    const sql = renderBenchmarkUpsert(rows.rows[0] as NonNullable<(typeof rows.rows)[0]>);
    expect(sql).toContain("insert into public.benchmarks");
    expect(sql).toContain("'O''Reilly'");
    expect(sql).toContain('{"de":"Anmerkung, de","en":"Note en"}');
    expect(sql).toContain(
      "on conflict (kpi_key, industry_section, size_band, period_year) do update set",
    );
    expect(sql).not.toMatch(/do update set[^;]*kpi_key = excluded/);
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
