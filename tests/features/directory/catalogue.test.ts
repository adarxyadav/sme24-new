// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CREDIT_PACK_KEYS,
  CREDIT_PACKS,
  CREDIT_PRICE_RAPPEN,
  DIRECTORY_CLAIMED_SIZE,
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

  it("claims a size in round thousands, so the rendered '+' is honest about its precision", () => {
    // The cards print the figure with a trailing "+", which only reads as true when the number
    // is a floor. A figure carrying hundreds or units would claim a precision a static constant
    // cannot keep.
    for (const value of Object.values(DIRECTORY_CLAIMED_SIZE)) {
      expect(value % 1000).toBe(0);
      expect(value).toBeGreaterThan(0);
    }
  });

  it("claims more contacts than companies, the shape of a contact list", () => {
    expect(DIRECTORY_CLAIMED_SIZE.contacts).toBeGreaterThan(DIRECTORY_CLAIMED_SIZE.companies);
  });

  it("names the twelve workbook columns", () => {
    expect(Object.keys(IMPORT_COLUMNS).length).toBe(12);
    expect(new Set(Object.values(IMPORT_COLUMNS)).size).toBe(12);
  });
});
