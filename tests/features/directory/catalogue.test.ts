// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CREDIT_PACK_KEYS,
  CREDIT_PACKS,
  CREDIT_PRICE_RAPPEN,
  IMPORT_COLUMNS,
} from "@/features/directory/catalogue";
import { PACKAGE_KEYS } from "@/features/marketing/packages";

describe("the directory catalogue (spec 0018, AC-6)", () => {
  it("prices every pack at credits times the unit price", () => {
    expect(CREDIT_PRICE_RAPPEN).toBe(199);
    for (const pack of CREDIT_PACKS) {
      expect(pack.priceRappen).toBe(pack.credits * CREDIT_PRICE_RAPPEN);
      expect(pack.credits).toBeGreaterThan(0);
    }
  });

  it("keeps the credit pack keys apart from the assessment package keys", () => {
    expect(CREDIT_PACKS.map((pack) => pack.key)).toEqual([...CREDIT_PACK_KEYS]);
    for (const key of CREDIT_PACK_KEYS) {
      expect((PACKAGE_KEYS as readonly string[]).includes(key)).toBe(false);
    }
  });

  it("names the twelve workbook columns", () => {
    expect(Object.keys(IMPORT_COLUMNS).length).toBe(12);
    expect(new Set(Object.values(IMPORT_COLUMNS)).size).toBe(12);
  });
});
