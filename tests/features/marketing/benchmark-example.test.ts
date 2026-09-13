import { describe, expect, it } from "vitest";
import { computeBenchmark, type ModelKpiRow, roundChf } from "@/features/benchmark/model";
import type { KpiKey } from "@/features/research/catalogue";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";
import { seedAssumptions, seedCatalogue, seedPeers } from "../benchmark/seed-helpers";

/**
 * The public worked example (spec 0016, AC-14): the homepage prints one franc figure, and it must
 * come from the same model and the same committed seed the product runs on. Replacing a seed value
 * that moves the example fails this test rather than letting the marketing figure drift away from
 * the model in silence.
 */

/** The franc figure the landing page prints, in both catalogs. */
function marketingFigures(): readonly string[] {
  return [de, en].map(
    (messages) => messages.marketing.landing.how.benchmarkCard.figure as unknown as string,
  );
}

describe("the public worked example (spec 0016, AC-14)", () => {
  // The example company the homepage names: 120 FTE in NOGA section C, with the accident rate at
  // the p75 of its own section's all sizes row, the "room to improve" end of the published spread.
  // At 120 FTE the model measures it against the section's `50-249` band row (amendment D4), so
  // the saving is computed against that row's median, not the all sizes one.
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
      country: "CH",
      updatedAt: "2026-09-11T00:00:00.000Z",
    },
    catalogue: seedCatalogue,
    kpis,
    peers,
    assumptions: seedAssumptions(),
  });

  it("computes the example from the committed seed through the real model", () => {
    expect(sectionC).toBeDefined();
    // The quartiles the card's own comment cites, so a seed edit that moves them is visible here.
    expect([sectionC?.p25, sectionC?.median, sectionC?.p75]).toEqual([29.3, 47.1, 65.8]);
    expect(body.inputs.section).toBe("C");
    expect(body.inputs.fte).toBe(120);
    expect(body.costChf).not.toBeNull();
    expect(body.savingMedianChf).not.toBeNull();
  });

  // The card is titled "Estimated EHS losses" ("Geschätzte EHS-Verluste"), and the figure it prints
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
