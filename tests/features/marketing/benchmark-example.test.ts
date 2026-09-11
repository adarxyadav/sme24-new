import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeBenchmark,
  type ModelAssumption,
  type ModelCatalogueEntry,
  type ModelKpiRow,
  type ModelPeerRow,
  roundChf,
} from "@/features/benchmark/model";
import {
  assumptionRowSchema,
  benchmarkRowSchema,
  parseCsv,
  parseSeedRows,
} from "@/features/benchmark/seed-schema";
import { KPI_CATALOGUE, KPI_KEYS, type KpiKey } from "@/features/research/catalogue";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/**
 * The public worked example (spec 0016, AC-14): the homepage prints one franc figure, and it must
 * come from the same model and the same committed seed the product runs on. Replacing a seed value
 * that moves the example fails this test rather than letting the marketing figure drift away from
 * the model in silence.
 */

const SEED_DIR = join(process.cwd(), "supabase/seed-data");

/** The committed peer rows as the model takes them. */
function seedPeers(): readonly ModelPeerRow[] {
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
function seedAssumptions(): readonly ModelAssumption[] {
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

const catalogue: readonly ModelCatalogueEntry[] = KPI_KEYS.map((key, index) => ({
  key,
  direction: KPI_CATALOGUE[key].direction,
  sortOrder: (index + 1) * 10,
}));

/** The franc figure the landing page prints, in both catalogs. */
function marketingFigures(): readonly string[] {
  return [de, en].map(
    (messages) => messages.marketing.landing.how.benchmarkCard.figure as unknown as string,
  );
}

describe("the public worked example (spec 0016, AC-14)", () => {
  // The example company the homepage names: 120 FTE in NOGA section C, sitting at the p75 of its
  // own section's accident rate, which is the "room to improve" end of the published spread.
  const peers = seedPeers();
  const sectionC = peers.find(
    (row) => row.kpiKey === "accident_rate_per_1000_fte" && row.industrySection === "C",
  );
  const kpis: readonly ModelKpiRow[] = [
    {
      id: "00000000-0000-4000-8000-000000000901",
      kpiKey: "accident_rate_per_1000_fte" as KpiKey,
      value: sectionC?.p75 ?? Number.NaN,
      periodYear: 2025,
      source: "research",
      confidence: 0.9,
      researchRunId: null,
    },
  ];

  const body = computeBenchmark({
    company: {
      id: "00000000-0000-4000-8000-000000000900",
      employeesCount: 120,
      industryCode: "23",
      updatedAt: "2026-09-11T00:00:00.000Z",
    },
    catalogue,
    kpis,
    peers,
    assumptions: seedAssumptions(),
  });

  it("computes the example from the committed seed through the real model", () => {
    expect(sectionC).toBeDefined();
    // The quartiles the card's own comment cites, so a seed edit that moves them is visible here.
    expect([sectionC?.p25, sectionC?.median, sectionC?.p75]).toEqual([34.9, 49.9, 66.4]);
    expect(body.inputs.section).toBe("C");
    expect(body.inputs.fte).toBe(120);
    expect(body.costChf).not.toBeNull();
    expect(body.savingMedianChf).not.toBeNull();
  });

  // The card is titled "Accident cost gap" ("Kostenlücke bei Unfällen"), so the figure it prints
  // is the saving at the peer median, not the total annual cost: a company at its section's p75
  // moving to the median. Comparing the total here would silently assert a different claim.
  it("matches the franc figure the landing page prints, in both catalogs", () => {
    const rounded = roundChf(body.savingMedianChf as number);
    // The catalogs write the figure with a non breaking space between the groups; compare on the
    // digits alone so the assertion does not turn into a whitespace test.
    const digitsOf = (text: string) => text.replace(/\D/g, "");
    for (const figure of marketingFigures()) {
      expect(
        digitsOf(figure),
        `the landing page prints ${figure}, the model computes ${rounded}`,
      ).toBe(String(rounded));
    }
  });

  it("keeps the point estimate inside the range the card and the email show", () => {
    expect(body.costLowChf).not.toBeNull();
    expect(body.costHighChf).not.toBeNull();
    expect(body.costLowChf as number).toBeLessThanOrEqual(body.costChf as number);
    expect(body.costHighChf as number).toBeGreaterThanOrEqual(body.costChf as number);
  });
});
