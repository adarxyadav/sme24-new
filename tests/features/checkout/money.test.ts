import { describe, expect, it } from "vitest";
import {
  chfToRappen,
  computeAmounts,
  isRappen,
  rappenToChf,
  roundRappen,
  roundToFiveRappen,
} from "@/features/checkout/money";

describe("computeAmounts (spec 0011 AC-2)", () => {
  it("prices the three packages exactly as the spec states", () => {
    // CHF 2'000 net at 8.1% is CHF 162.00 VAT and CHF 2'162.00 gross (spec 0011, test scenarios).
    expect(computeAmounts(200_000, 0.081)).toEqual({
      netRappen: 200_000,
      vatRate: 0.081,
      vatRappen: 16_200,
      grossRappen: 216_200,
    });
    expect(computeAmounts(500_000, 0.081).grossRappen).toBe(540_500);
    expect(computeAmounts(1_000_000, 0.081).grossRappen).toBe(1_081_000);
  });

  it("keeps gross exactly net plus vat over a wide range of prices", () => {
    for (let net = 1; net <= 20_000; net += 7) {
      const amounts = computeAmounts(net, 0.081);
      expect(amounts.grossRappen).toBe(amounts.netRappen + amounts.vatRappen);
      expect(Number.isSafeInteger(amounts.vatRappen)).toBe(true);
      expect(Number.isSafeInteger(amounts.grossRappen)).toBe(true);
    }
  });

  it("rounds the VAT to the nearest whole Rappen, never leaving a fraction", () => {
    // 12345 * 0.081 = 999.945, which rounds to 1000.
    expect(computeAmounts(12_345, 0.081).vatRappen).toBe(1_000);
    // 1000 * 0.081 = 81 exactly.
    expect(computeAmounts(1_000, 0.081).vatRappen).toBe(81);
    // A half lands away from zero: 500 * 0.081 = 40.5 rounds to 41.
    expect(computeAmounts(500, 0.081).vatRappen).toBe(41);
  });

  it("handles a zero rate and a future rate change without special casing", () => {
    expect(computeAmounts(200_000, 0).vatRappen).toBe(0);
    expect(computeAmounts(200_000, 0).grossRappen).toBe(200_000);
    // A rate change is a data migration, so the function must simply take the new rate.
    expect(computeAmounts(200_000, 0.077).vatRappen).toBe(15_400);
  });

  it("refuses a net price that is not a positive whole number of Rappen", () => {
    expect(() => computeAmounts(0, 0.081)).toThrow();
    expect(() => computeAmounts(-1, 0.081)).toThrow();
    expect(() => computeAmounts(200_000.5, 0.081)).toThrow();
    expect(() => computeAmounts(Number.NaN, 0.081)).toThrow();
    expect(() => computeAmounts(Number.POSITIVE_INFINITY, 0.081)).toThrow();
  });

  it("refuses a rate that is not a fraction below one", () => {
    expect(() => computeAmounts(200_000, -0.01)).toThrow();
    expect(() => computeAmounts(200_000, 1)).toThrow();
    expect(() => computeAmounts(200_000, Number.NaN)).toThrow();
  });
});

describe("Rappen helpers", () => {
  it("recognises a storable Rappen amount", () => {
    expect(isRappen(0)).toBe(true);
    expect(isRappen(216_200)).toBe(true);
    expect(isRappen(-1)).toBe(false);
    expect(isRappen(1.5)).toBe(false);
    expect(isRappen(Number.NaN)).toBe(false);
  });

  it("rounds halves away from zero in both directions", () => {
    expect(roundRappen(0.5)).toBe(1);
    expect(roundRappen(1.5)).toBe(2);
    expect(roundRappen(-0.5)).toBe(-1);
    expect(roundRappen(2.4)).toBe(2);
  });

  it("converts to CHF for display only", () => {
    expect(rappenToChf(216_200)).toBe(2_162);
    expect(rappenToChf(5)).toBe(0.05);
  });

  it("converts a whole franc price to Rappen and rejects sub Rappen precision", () => {
    expect(chfToRappen(2_000)).toBe(200_000);
    expect(chfToRappen(19.95)).toBe(1_995);
    expect(() => chfToRappen(19.999)).toThrow();
  });

  it("rounds to the nearest five Rappen for a cash display", () => {
    expect(roundToFiveRappen(216_200)).toBe(216_200);
    expect(roundToFiveRappen(101)).toBe(100);
    expect(roundToFiveRappen(103)).toBe(105);
    expect(roundToFiveRappen(102)).toBe(100);
    // 2.5 rounds away from zero to 5.
    expect(roundToFiveRappen(1_007)).toBe(1_005);
  });
});
