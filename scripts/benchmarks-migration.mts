/**
 * Generates the benchmark seed migration (spec 0008, AC-2):
 *
 *   pnpm benchmarks:migration
 *
 * Parses supabase/seed-data/benchmarks.csv and benchmark-assumptions.csv with the Zod schemas of
 * src/features/benchmark/seed-schema.ts, fails with the file and line number on the first invalid
 * row, and writes supabase/migrations/<timestamp>_benchmark_seed.sql holding one upsert per row,
 * with a timestamp strictly later than the newest migration. Plain Node (type stripping), so the
 * imported modules use relative `.ts` paths and no alias.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  nextMigrationTimestamp,
  renderSeedMigration,
} from "../src/features/benchmark/seed-migration.ts";
import {
  assumptionFileSchema,
  assumptionRowSchema,
  benchmarkRowSchema,
  parseCsv,
  parseSeedRows,
} from "../src/features/benchmark/seed-schema.ts";

const SEED_DIR = join(process.cwd(), "supabase/seed-data");
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const BENCHMARKS_FILE = "benchmarks.csv";
const ASSUMPTIONS_FILE = "benchmark-assumptions.csv";

function fail(message: string): never {
  console.error(`benchmarks:migration: ${message}`);
  process.exit(1);
}

function readTable(file: string) {
  try {
    return parseCsv(readFileSync(join(SEED_DIR, file), "utf8"));
  } catch (error) {
    return fail(`${file}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const benchmarks = parseSeedRows(readTable(BENCHMARKS_FILE), benchmarkRowSchema);
if (!benchmarks.ok) {
  fail(`${BENCHMARKS_FILE} line ${benchmarks.error.line}: ${benchmarks.error.message}`);
}
const assumptionRows = parseSeedRows(readTable(ASSUMPTIONS_FILE), assumptionRowSchema);
if (!assumptionRows.ok) {
  fail(`${ASSUMPTIONS_FILE} line ${assumptionRows.error.line}: ${assumptionRows.error.message}`);
}
const assumptions = assumptionFileSchema.safeParse(assumptionRows.rows);
if (!assumptions.success) {
  fail(`${ASSUMPTIONS_FILE}: ${assumptions.error.issues[0]?.message ?? "invalid file"}`);
}

const now = new Date();
const stamp = nextMigrationTimestamp(readdirSync(MIGRATIONS_DIR), now);
const target = join(MIGRATIONS_DIR, `${stamp}_benchmark_seed.sql`);
writeFileSync(target, renderSeedMigration(benchmarks.rows, assumptions.data, now));
console.log(
  `benchmarks:migration: wrote ${target} (${benchmarks.rows.length} peer rows, ${assumptions.data.length} assumptions)`,
);
