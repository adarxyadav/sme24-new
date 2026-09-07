import { describe, expect, it } from "vitest";
import { billingAddressSchema, isValidSwissUid } from "@/features/checkout/schema";

/**
 * The Swiss UID check digit (spec 0011, AC-11). The algorithm is eCH-0097 version 2.0: the
 * weights 5,4,3,2,7,6,5,4 over the first eight digits, mod 11, check digit 11 minus the
 * remainder, a remainder of 0 giving 0, and a computed 10 meaning the number was never issued.
 * The valid fixtures are real UIDs published in the federal register at uid.admin.ch.
 */

// Real, currently registered Swiss companies (uid.admin.ch).
const SWISSCOM = "CHE-101.654.423";
const NESTLE_SUISSE = "CHE-101.237.723";
const NOVARTIS = "CHE-103.867.266";
// The worked example printed in the eCH-0097 standard itself.
const ECH_EXAMPLE = "CHE-109.322.551";

describe("isValidSwissUid (spec 0011 AC-11)", () => {
  it("accepts real UIDs from the federal register", () => {
    expect(isValidSwissUid(SWISSCOM)).toBe(true);
    expect(isValidSwissUid(NESTLE_SUISSE)).toBe(true);
    expect(isValidSwissUid(NOVARTIS)).toBe(true);
  });

  it("accepts the worked example from the eCH-0097 standard", () => {
    expect(isValidSwissUid(ECH_EXAMPLE)).toBe(true);
  });

  it("accepts the VAT suffix in all three official languages", () => {
    expect(isValidSwissUid(`${SWISSCOM} MWST`)).toBe(true);
    expect(isValidSwissUid(`${SWISSCOM} TVA`)).toBe(true);
    expect(isValidSwissUid(`${SWISSCOM} IVA`)).toBe(true);
  });

  it("ignores surrounding whitespace", () => {
    expect(isValidSwissUid(`  ${SWISSCOM}  `)).toBe(true);
  });

  it("rejects a wrong check digit", () => {
    // Swisscom's number with the check digit moved off by one.
    expect(isValidSwissUid("CHE-101.654.424")).toBe(false);
    expect(isValidSwissUid("CHE-101.237.720")).toBe(false);
  });

  it("rejects a malformed shape", () => {
    expect(isValidSwissUid("")).toBe(false);
    expect(isValidSwissUid("CHE-101654423")).toBe(false);
    expect(isValidSwissUid("101.654.423")).toBe(false);
    expect(isValidSwissUid("CHE-101.654.42")).toBe(false);
    expect(isValidSwissUid("CHE-101.654.4233")).toBe(false);
    expect(isValidSwissUid("DE-101.654.423")).toBe(false);
    expect(isValidSwissUid("CHE-abc.def.ghi")).toBe(false);
    expect(isValidSwissUid(`${SWISSCOM} VAT`)).toBe(false);
  });

  it("accepts at most one check digit for any given payload", () => {
    // The check digit is a function of the first eight digits, so exactly one of the ten
    // candidates may pass, and none may when the computed digit would be 10.
    for (const payload of ["101.654.42", "109.322.55", "000.000.00"]) {
      const accepted = Array.from({ length: 10 }, (_, digit) => `CHE-${payload}${digit}`).filter(
        isValidSwissUid,
      );
      expect(accepted.length).toBeLessThanOrEqual(1);
    }
  });

  it("rejects a payload whose check digit would be 10, which is never issued", () => {
    // 00000000 weights to 0, so remainder 0 gives check digit 0 and only that digit passes.
    expect(isValidSwissUid("CHE-000.000.000")).toBe(true);
    expect(isValidSwissUid("CHE-000.000.001")).toBe(false);
    // 10000000 weights to 5; 5 mod 11 = 5, so the check digit is 6 and nothing else passes.
    expect(isValidSwissUid("CHE-100.000.006")).toBe(true);
    expect(isValidSwissUid("CHE-100.000.005")).toBe(false);
  });
});

describe("billingAddressSchema (spec 0011 AC-11)", () => {
  const valid = {
    billingName: "Muster AG",
    billingStreet: "Bahnhofstrasse 1",
    billingPostcode: "8001",
    billingTown: "Zurich",
    billingCountry: "CH",
    billingUid: "",
  };

  it("accepts an address with no UID and stores null rather than an empty string", () => {
    const result = billingAddressSchema.safeParse(valid);
    expect(result.success).toBe(true);
    expect(result.data?.billingUid).toBeNull();
  });

  it("accepts a valid UID", () => {
    const result = billingAddressSchema.safeParse({ ...valid, billingUid: SWISSCOM });
    expect(result.success).toBe(true);
    expect(result.data?.billingUid).toBe(SWISSCOM);
  });

  it("rejects a malformed UID", () => {
    expect(billingAddressSchema.safeParse({ ...valid, billingUid: "CHE-1" }).success).toBe(false);
    expect(
      billingAddressSchema.safeParse({ ...valid, billingUid: "CHE-101.654.424" }).success,
    ).toBe(false);
  });

  it("trims every field and uppercases the country", () => {
    const result = billingAddressSchema.safeParse({
      ...valid,
      billingName: "  Muster AG  ",
      billingCountry: "ch",
    });
    expect(result.data?.billingName).toBe("Muster AG");
    expect(result.data?.billingCountry).toBe("CH");
  });

  it("requires the four address fields", () => {
    for (const field of [
      "billingName",
      "billingStreet",
      "billingPostcode",
      "billingTown",
    ] as const) {
      expect(billingAddressSchema.safeParse({ ...valid, [field]: "" }).success).toBe(false);
      expect(billingAddressSchema.safeParse({ ...valid, [field]: "   " }).success).toBe(false);
    }
  });

  it("rejects a country that is not two letters", () => {
    expect(billingAddressSchema.safeParse({ ...valid, billingCountry: "CHE" }).success).toBe(false);
    expect(billingAddressSchema.safeParse({ ...valid, billingCountry: "1" }).success).toBe(false);
  });
});
