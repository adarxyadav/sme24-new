import { describe, expect, it } from "vitest";
import {
  BUBBLE_RADIUS_MAX,
  BUBBLE_RADIUS_MIN,
  bubbleRadius,
  chartDomain,
  niceStep,
  niceTicks,
  tickDecimals,
} from "@/features/benchmark/ui/chart-scale";

describe("the chart scale (spec 0022, the D-chart)", () => {
  it("widens the domain by 8 percent of the span on each side", () => {
    expect(chartDomain([0.9, 4.0])).toEqual([0.9 - 0.31 * 0.8, 4.0 + 0.31 * 0.8]);
    // A single value has no span of its own, so it is given one.
    expect(chartDomain([2.4])).toEqual([2.4 - 0.08, 2.4 + 0.08]);
  });

  it("sizes a bubble by area, not by radius, so a loss four times larger draws twice as wide", () => {
    expect(bubbleRadius(1_000_000, 1_000_000)).toBe(BUBBLE_RADIUS_MAX);
    // A quarter of the largest loss is half the radius: area, not radius, carries the money.
    expect(bubbleRadius(250_000, 1_000_000)).toBe(BUBBLE_RADIUS_MAX / 2);
  });

  it("floors the radius, so a tiny or an unpriced loss is still a visible mark", () => {
    // A peer that published no headcount has no loss to price, and the client is never sized at all.
    expect(bubbleRadius(null, 1_000_000)).toBe(BUBBLE_RADIUS_MIN);
    expect(bubbleRadius(0, 1_000_000)).toBe(BUBBLE_RADIUS_MIN);
    expect(bubbleRadius(300, 284_526)).toBe(BUBBLE_RADIUS_MIN);
    // No largest to scale against (every point unpriced) is the floor too, never a divide by zero.
    expect(bubbleRadius(500_000, 0)).toBe(BUBBLE_RADIUS_MIN);
  });

  it("steps by 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(0, 5)).toBe(1);
  });

  it("annotates a domain with round ticks inside it and says how many decimals they need", () => {
    expect(niceTicks(chartDomain([0.9, 4.0]), 5)).toEqual([1, 2, 3, 4]);
    expect(niceTicks(chartDomain([9.8, 71.2, 14.5]), 4)).toEqual([20, 40, 60]);
    expect(niceTicks(chartDomain([2.4]), 5)).toEqual([2.35, 2.4, 2.45]);
    // Never outside the padded domain, whatever the target.
    const [low, high] = chartDomain([5, 13]);
    for (const tick of niceTicks([low, high], 5)) {
      expect(tick).toBeGreaterThanOrEqual(low);
      expect(tick).toBeLessThanOrEqual(high);
    }
  });

  it("counts the decimals the longest tick needs, so every tick prints exactly", () => {
    expect(tickDecimals([1, 2, 3, 4])).toBe(0);
    expect(tickDecimals([12.5, 15, 17.5, 20])).toBe(1);
    expect(tickDecimals([2.35, 2.4, 2.45])).toBe(2);
  });
});
