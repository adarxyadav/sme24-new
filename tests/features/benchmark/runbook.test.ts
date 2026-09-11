import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MODEL_VERSION } from "@/features/benchmark/catalogue";
import { computeBenchmark, type ModelKpiRow, roundChf } from "@/features/benchmark/model";
import { assumptionRowSchema, parseCsv, parseSeedRows } from "@/features/benchmark/seed-schema";
import { SNAPSHOT_SCHEMAS } from "@/features/benchmark/snapshot";
import { KPI_KEYS } from "@/features/research/catalogue";
import { FIXTURE_VALUES } from "@/lib/research/fixture";
import { seedAssumptions, seedCatalogue, seedPeers } from "./seed-helpers";

/**
 * The launch gate runbook (spec 0016, AC-17): `docs/benchmark.md` is what the owner reads at the
 * promotion, so the names it calls "expected" must be exactly the rows the seed actually flags.
 * A curator who clears a flag in the CSV without editing the runbook would otherwise leave the
 * gate naming a row that no longer declares itself, or silently permitting one that does. Both
 * halves are read from the committed files, so the drift fails the build rather than the gate.
 */

const RUNBOOK = readFileSync(join(process.cwd(), "docs/benchmark.md"), "utf8");
const SEED_DIR = join(process.cwd(), "supabase/seed-data");

/** The assumption rows the committed CSV declares as assumptions with no published source. */
function declaredAssumptionKeys(): readonly string[] {
  const rows = parseSeedRows(
    parseCsv(readFileSync(join(SEED_DIR, "benchmark-assumptions.csv"), "utf8")),
    assumptionRowSchema,
  );
  if (!rows.ok) throw new Error(rows.error.message);
  return rows.rows.filter((row) => row.is_assumption).map((row) => row.key);
}

describe("the launch gate runbook (spec 0016, AC-17)", () => {
  // Two queries, because an unread value and an unsourceable one are different problems. A single
  // query would force the owner to either lie or switch the gate off.
  it("names both gate queries, one per flag", () => {
    expect(RUNBOOK).toContain("where provisional");
    expect(RUNBOOK).toContain("where is_assumption");
    expect(RUNBOOK).toContain("public.benchmarks");
    expect(RUNBOOK).toContain("public.benchmark_assumptions");
  });

  // The heart of the check: the runbook's expected list and the seed's flags are one fact written
  // in two places, so they are compared rather than trusted.
  it("lists exactly the assumption keys the committed seed declares", () => {
    const declared = declaredAssumptionKeys();
    expect(declared.length).toBeGreaterThan(0);
    // Read only the gate's own "Expected, and only these" sentence, not the whole document. Each
    // multiplier key is also written in the source table further up, so scanning everything would
    // find a key in that second copy and pass even after the gate's list lost it, which is exactly
    // the drift this test exists to catch.
    const expectedLine = RUNBOOK.split("\n").find((line) => line.startsWith("Expected, and only"));
    expect(expectedLine).toBeDefined();
    // Only the key list itself, which ends at the "all on <table>" clause: that clause names the
    // table the keys live on, and counting it as a key would fail against the seed every time.
    const keyList = (expectedLine as string).split(", all on")[0] ?? "";
    // Whole backticked tokens, so `indirect_multiplier` cannot match inside
    // `indirect_multiplier_high`.
    const listed = [...keyList.matchAll(/`([a-z0-9_]+)`/g)].map((match) => match[1]);
    // Set equality both ways: a key the seed declares but the gate omits would let an unsourced
    // claim through unnamed, and a key the gate names but the seed no longer flags would have the
    // owner tick a row that is not there any more.
    expect([...listed].sort()).toEqual([...declared].sort());
  });

  // A peer row declaring itself an assumption is a new claim without a source, so the runbook says
  // so and the seed must not contain one.
  it("keeps every declared assumption on the assumptions table, never on a peer row", () => {
    const table = parseCsv(readFileSync(join(SEED_DIR, "benchmarks.csv"), "utf8"));
    const flagged = table.records.filter((record) => record.fields.is_assumption === "true");
    expect(flagged).toHaveLength(0);
    expect(RUNBOOK).toContain("No peer row may be a declared assumption");
  });

  // The two flags mean different things and the runbook is where that distinction is recorded for
  // whoever runs the curation pass months from now.
  it("records what each flag means and that they are never both true", () => {
    expect(RUNBOOK).toContain("`provisional`");
    expect(RUNBOOK).toContain("`is_assumption`");
    expect(RUNBOOK).toContain("never both true");
  });
});

/**
 * The runbook and the code are one fact written in two places (spec 0016 amendment, AC-18): the
 * live model version, the keys of the version map, and the worked example figure. The runbook
 * carried `@2` in three places while the code wrote `@3`, and an example figure the seed no longer
 * gave, for a week before anyone noticed; these pins make that a failing build instead.
 */
describe("the runbook matches the code (spec 0016 amendment, AC-18)", () => {
  it("names the live model version and every key of the version map", () => {
    expect(RUNBOOK).toContain(`\`${MODEL_VERSION}\``);
    // The sentence describing the map names every version in it, so a bump that forgets the
    // runbook fails here rather than leaving the reader with a stale list.
    const mapLine = RUNBOOK.split("\n").find((line) => line.includes("`SNAPSHOT_SCHEMAS`"));
    expect(mapLine).toBeDefined();
    for (const version of Object.keys(SNAPSHOT_SCHEMAS)) {
      expect(mapLine, `the version map sentence names ${version}`).toContain(version);
    }
  });

  // The local proof paragraph quotes the fixture company's cost. Computed here from the fixture
  // values and the committed seed through the real model, the way the marketing example is.
  it("quotes the fixture company's cost as the committed seed actually gives it", () => {
    const kpis: readonly ModelKpiRow[] = KPI_KEYS.map((key, index) => ({
      id: `00000000-0000-4000-8000-${String(800 + index).padStart(12, "0")}`,
      kpiKey: key,
      value: FIXTURE_VALUES[key],
      periodYear: 2025,
      source: "research",
      confidence: 0.9,
      researchRunId: null,
    }));
    const body = computeBenchmark({
      company: {
        id: "00000000-0000-4000-8000-000000000799",
        employeesCount: 420,
        industryCode: "23.61",
        updatedAt: "2026-09-12T00:00:00.000Z",
      },
      catalogue: seedCatalogue,
      kpis,
      peers: seedPeers(),
      assumptions: seedAssumptions(),
    });
    expect(body.costChf).not.toBeNull();
    const rounded = roundChf(body.costChf as number);
    const line = RUNBOOK.split("\n").find((text) =>
      text.includes("The whole thread runs without a vendor"),
    );
    expect(line).toBeDefined();
    const quoted = /a cost of about CHF (\d[\d ]*\d)/.exec(line as string)?.[1] ?? "";
    expect(
      quoted.replace(/\D/g, ""),
      `the runbook says CHF ${quoted}, the model gives ${rounded}`,
    ).toBe(String(rounded));
  });

  // The three Eurostat tables the amendment found readable are named where the next curator will
  // look, so the dead end of "no fatality rate, no size bands, no lost days" cannot come back.
  it("records the three Eurostat tables as readable", () => {
    for (const code of ["hsw_n2_02", "hsw_n2_04", "hsw_n2_05"]) {
      expect(RUNBOOK).toContain(`\`${code}\``);
    }
    expect(RUNBOOK).not.toContain("confirmed is unreadable");
    expect(RUNBOOK).not.toContain("No fatality rate and no near miss rate is published by sector");
  });
});
