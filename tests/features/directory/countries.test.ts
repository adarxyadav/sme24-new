// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  COUNTRY_CODES,
  COUNTRY_NAMES,
  countryCode,
  countryLookupKey,
  isCountryCode,
} from "@/features/directory/countries";

describe("the directory country map (spec 0018, AC-2)", () => {
  it("lists the 249 ISO 3166 alpha 2 codes once each", () => {
    expect(COUNTRY_CODES.length).toBe(249);
    expect(new Set(COUNTRY_CODES).size).toBe(249);
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/);
  });

  it("maps every spelling to a valid code, under a normalised key", () => {
    for (const [spelling, code] of Object.entries(COUNTRY_NAMES)) {
      expect(isCountryCode(code), `${spelling} -> ${code}`).toBe(true);
      expect(countryLookupKey(spelling), spelling).toBe(spelling);
    }
  });

  it("normalises a raw cell before looking it up", () => {
    expect(countryCode("Malaysia.")).toBe("MY");
    expect(countryCode("Nicaragua,")).toBe("NI");
    expect(countryCode("  United   States ")).toBe("US");
    expect(countryCode("SWITZERLAND")).toBe("CH");
    expect(countryCode("Schweiz")).toBe("CH");
  });

  it("accepts a two letter value that is itself a valid code", () => {
    expect(countryCode("Gb")).toBe("GB");
    expect(countryCode("es")).toBe("ES");
  });

  it("never guesses: an unmapped or ambiguous spelling is null", () => {
    expect(countryCode("Virgin Islands")).toBeNull();
    expect(countryCode("West Indies")).toBeNull();
    expect(countryCode("United")).toBeNull();
    expect(countryCode("623-932- 7000")).toBeNull();
    expect(countryCode("XX")).toBeNull();
    expect(countryCode("")).toBeNull();
  });
});
