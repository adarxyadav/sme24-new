import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assumptionRowSchema, parseCsv, parseSeedRows } from "@/features/benchmark/seed-schema";

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
