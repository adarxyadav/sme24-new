import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ModelAssumption,
  ModelCatalogueEntry,
  ModelPeerRow,
} from "@/features/benchmark/model";
import {
  assumptionRowSchema,
  benchmarkRowSchema,
  parseCsv,
  parseSeedRows,
} from "@/features/benchmark/seed-schema";
import { KPI_CATALOGUE, KPI_KEYS } from "@/features/research/catalogue";

/**
 * The committed seed CSVs as the model takes them, shared by every test that runs the real seed
 * through `computeBenchmark` (the marketing example of spec 0016 AC-14 and the runbook's worked
 * example of the 2026-09-12 amendment AC-18). Test only.
 */

const SEED_DIR = join(process.cwd(), "supabase/seed-data");

/** The committed peer rows as the model takes them. */
export function seedPeers(): readonly ModelPeerRow[] {
  const parsed = parseSeedRows(
    parseCsv(readFileSync(join(SEED_DIR, "benchmarks.csv"), "utf8")),
    benchmarkRowSchema,
  );
  if (!parsed.ok) throw new Error(`benchmarks.csv: ${parsed.error.message}`);
  return parsed.rows.map((row, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    kpiKey: row.kpi_key,
    industrySection: row.industry_section,
    sizeBand: row.size_band,
    periodYear: row.period_year,
    p25: row.p25,
    median: row.median,
    p75: row.p75,
    sampleSize: row.sample_size,
    provisional: row.provisional,
    sourceKey: row.source_key,
    basis: row.basis_de && row.basis_en ? { de: row.basis_de, en: row.basis_en } : null,
  }));
}

/** The committed assumptions as the model takes them. */
export function seedAssumptions(): readonly ModelAssumption[] {
  const parsed = parseSeedRows(
    parseCsv(readFileSync(join(SEED_DIR, "benchmark-assumptions.csv"), "utf8")),
    assumptionRowSchema,
  );
  if (!parsed.ok) throw new Error(`benchmark-assumptions.csv: ${parsed.error.message}`);
  return parsed.rows.map((row) => ({
    key: row.key,
    value: row.value,
    unit: row.unit,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    provisional: row.provisional,
    effectiveFrom: row.effective_from,
    isAssumption: row.is_assumption,
    note: row.note_de && row.note_en ? { de: row.note_de, en: row.note_en } : null,
  }));
}

/** The catalogue as the model takes it, in `KPI_KEYS` order. */
export const seedCatalogue: readonly ModelCatalogueEntry[] = KPI_KEYS.map((key, index) => ({
  key,
  direction: KPI_CATALOGUE[key].direction,
  sortOrder: (index + 1) * 10,
}));
