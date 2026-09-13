import { describe, expect, it } from "vitest";
import {
  COUNTRIES,
  COUNTRY_CODES,
  countryName,
  currencyOf,
  isCountryCode,
  isEuropean,
  REGIONS,
  regionOf,
} from "@/lib/countries";

/**
 * The country catalogue (spec 0021, AC-1): 32 codes, each in exactly one region with one three
 * letter currency, the DACH four together, Bulgaria in the euro, and names from the runtime
 * rather than from a message key.
 */
describe("the country catalogue (spec 0021, AC-1)", () => {
  it("holds the EU 27 plus CH, LI, NO, IS and GB, each code once", () => {
    expect(COUNTRIES).toHaveLength(32);
    expect(new Set(COUNTRY_CODES).size).toBe(32);
    for (const code of ["CH", "LI", "NO", "IS", "GB", "DE", "FR", "MT", "CY"]) {
      expect(isCountryCode(code), code).toBe(true);
    }
    expect(isCountryCode("US")).toBe(false);
    expect(isCountryCode("ch")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });

  it("gives every code exactly one region and a three letter currency", () => {
    for (const country of COUNTRIES) {
      expect(REGIONS, country.code).toContain(country.region);
      expect(country.currency, country.code).toMatch(/^[A-Z]{3}$/);
      expect(regionOf(country.code)).toBe(country.region);
      expect(currencyOf(country.code)).toBe(country.currency);
      expect(isEuropean(country.code)).toBe(true);
    }
    expect(REGIONS).toHaveLength(6);
  });

  it("puts CH, DE, AT and LI in dach and maps BG to the euro", () => {
    for (const code of ["CH", "DE", "AT", "LI"]) expect(regionOf(code), code).toBe("dach");
    expect(currencyOf("BG")).toBe("EUR");
    expect(currencyOf("CH")).toBe("CHF");
    expect(currencyOf("LI")).toBe("CHF");
  });

  it("answers null and not European for a code outside the catalogue, never an error", () => {
    expect(regionOf("US")).toBeNull();
    expect(currencyOf("US")).toBeNull();
    expect(isEuropean("US")).toBe(false);
    expect(isEuropean(null)).toBe(false);
    expect(isEuropean(undefined)).toBe(false);
  });

  it("names a country in both locales through Intl.DisplayNames", () => {
    expect(countryName("CH", "en")).toBe("Switzerland");
    expect(countryName("CH", "de")).toBe("Schweiz");
    expect(countryName("DE", "en")).toBe("Germany");
    // An unknown code falls back to the code itself rather than throwing.
    expect(countryName("ZZ", "en")).toMatch(/^(ZZ|Unknown Region)$/);
  });
});
