import { describe, expect, it } from "vitest";
import { HERO_EXAMPLE, trackLayout } from "@/features/marketing/hero-example";
import { PACKAGE_KEYS } from "@/features/marketing/packages";
import { KPI_KEYS } from "@/features/research/catalogue";

describe("trackLayout", () => {
  const quartiles = { p25: 2, median: 4, p75: 6 };

  it("pins the three quartile ticks at a quarter, the middle and three quarters", () => {
    expect(trackLayout(4, quartiles)).toMatchObject({ p25: 25, median: 50, p75: 75 });
  });

  it("puts the median on the middle and the quartiles on their ticks", () => {
    expect(trackLayout(4, quartiles).marker).toBe(50);
    expect(trackLayout(2, quartiles).marker).toBe(25);
    expect(trackLayout(6, quartiles).marker).toBe(75);
  });

  it("holds an outlier inside the track", () => {
    expect(trackLayout(40, quartiles).marker).toBe(96);
    expect(trackLayout(-40, quartiles).marker).toBe(4);
  });

  it("places a value on a peer group without a scale at p25 or at the far edge", () => {
    const flat = { p25: 0, median: 0, p75: 0 };
    expect(trackLayout(0, flat).marker).toBe(25);
    expect(trackLayout(1, flat).marker).toBe(96);
  });
});

describe("HERO_EXAMPLE", () => {
  it("covers every KPI of the catalogue exactly once", () => {
    expect(HERO_EXAMPLE.positions.map((position) => position.key)).toEqual(KPI_KEYS);
  });

  it("ranks the gaps by their saving, the way the dashboard does", () => {
    const savings = HERO_EXAMPLE.gaps.map((gap) => gap.savingChf);
    expect(savings).toEqual([...savings].sort((a, b) => b - a));
    expect(savings.reduce((sum, value) => sum + value, 0)).toBe(HERO_EXAMPLE.cost.savingMedianChf);
  });

  it("keeps the estimate inside its range and the top quarter saving above the median one", () => {
    const { estimateChf, lowChf, highChf, savingMedianChf, savingTopChf } = HERO_EXAMPLE.cost;
    expect(estimateChf).toBeGreaterThan(lowChf);
    expect(estimateChf).toBeLessThan(highChf);
    expect(savingTopChf).toBeGreaterThan(savingMedianChf);
  });

  it("recommends a package that exists and carries a fixed price", () => {
    expect(PACKAGE_KEYS).toContain(HERO_EXAMPLE.nextStep);
    expect(HERO_EXAMPLE.nextStep).not.toBe("retainer");
  });
});
