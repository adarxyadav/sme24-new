import { describe, expect, it } from "vitest";
import {
  isSellerPlaceholder,
  SELLER_PLACEHOLDERS,
  type Seller,
  sellerPlaceholders,
} from "@/features/checkout/seller-facts";

/**
 * The placeholder guard (spec 0011, AC-17), mirroring the site facts guard of spec 0009. It keeps
 * a placeholder seller off a real invoice: a QR bill carrying the wrong IBAN would send a client's
 * money to nobody.
 */

const REAL: Seller = {
  name: "IC Hotz GmbH",
  address: "Obermühle 5, 6340 Baar",
  uid: "CHE-101.654.423 MWST",
  iban: "CH9300762011623852957",
};

describe("seller placeholder guard (spec 0011 AC-17)", () => {
  it("reports no placeholder once every fact is configured", () => {
    expect(sellerPlaceholders(REAL)).toEqual([]);
  });

  it("names every field still carrying a placeholder", () => {
    expect(sellerPlaceholders(SELLER_PLACEHOLDERS)).toEqual(["name", "address", "uid", "iban"]);
  });

  it("names an individual unset field", () => {
    expect(sellerPlaceholders({ ...REAL, iban: SELLER_PLACEHOLDERS.iban })).toEqual(["iban"]);
    expect(sellerPlaceholders({ ...REAL, uid: SELLER_PLACEHOLDERS.uid })).toEqual(["uid"]);
  });

  it("treats an empty or blank value as a placeholder", () => {
    expect(sellerPlaceholders({ ...REAL, name: "" })).toEqual(["name"]);
    expect(sellerPlaceholders({ ...REAL, name: "   " })).toEqual(["name"]);
  });

  it("recognises a placeholder field by field", () => {
    expect(isSellerPlaceholder("iban", SELLER_PLACEHOLDERS.iban)).toBe(true);
    expect(isSellerPlaceholder("iban", REAL.iban)).toBe(false);
    expect(isSellerPlaceholder("name", "")).toBe(true);
  });

  it("keeps the placeholders obviously fake, so one can never pass for a real invoice", () => {
    expect(SELLER_PLACEHOLDERS.name).toMatch(/PLACEHOLDER/);
    expect(SELLER_PLACEHOLDERS.address).toMatch(/PLACEHOLDER/);
    expect(SELLER_PLACEHOLDERS.uid).toBe("CHE-000.000.000 MWST");
    expect(SELLER_PLACEHOLDERS.iban).toMatch(/^CH0+$/);
  });
});
