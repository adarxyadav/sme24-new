import { describe, expect, it } from "vitest";
import { COUNTRY_CODES as ISO_CODES } from "@/features/directory/countries";
import {
  COUNTRIES,
  COUNTRY_CODES,
  countryName,
  currencyOf,
  EUROPEAN_REGIONS,
  isCountryCode,
  isEuropean,
  REGIONS,
  regionCountriesOf,
  regionOf,
} from "@/lib/countries";

/**
 * The world country catalogue (spec 0022, AC-2): every ISO 3166 alpha 2 code with one region and
 * one three letter currency, the 32 European codes of spec 0021 unchanged in their six regions,
 * and every other code in one of the four world regions.
 */
describe("the world country catalogue (spec 0022, AC-2)", () => {
  it("covers every ISO 3166 alpha 2 code exactly once", () => {
    expect(COUNTRIES).toHaveLength(ISO_CODES.length);
    expect(new Set(COUNTRY_CODES).size).toBe(ISO_CODES.length);
    // The same set the directory's list holds, so no code the product knows is missing here.
    expect(new Set(COUNTRY_CODES)).toEqual(new Set<string>(ISO_CODES));
  });

  it("gives every code exactly one region and a three letter currency", () => {
    for (const country of COUNTRIES) {
      expect(REGIONS, country.code).toContain(country.region);
      expect(country.currency, country.code).toMatch(/^[A-Z]{3}$/);
      expect(regionOf(country.code)).toBe(country.region);
      expect(currencyOf(country.code)).toBe(country.currency);
    }
    expect(REGIONS).toHaveLength(10);
    expect(EUROPEAN_REGIONS).toHaveLength(6);
  });

  it("keeps the six European regions and their 32 members unchanged (spec 0021, AC-1)", () => {
    const european = COUNTRIES.filter((country) => isEuropean(country.code));
    expect(european).toHaveLength(32);
    for (const code of ["CH", "DE", "AT", "LI"]) expect(regionOf(code), code).toBe("dach");
    expect(regionOf("GB")).toBe("british_isles");
    expect(regionOf("BG")).toBe("central_eastern");
    expect(currencyOf("CH")).toBe("CHF");
    expect(currencyOf("LI")).toBe("CHF");
    expect(currencyOf("BG")).toBe("EUR");
  });

  it("puts every other code in one of the four world regions", () => {
    expect(regionOf("US")).toBe("north_america");
    expect(regionOf("BR")).toBe("latin_america");
    expect(regionOf("ZA")).toBe("middle_east_africa");
    expect(regionOf("JP")).toBe("asia_pacific");
    expect(currencyOf("US")).toBe("USD");
    expect(currencyOf("JP")).toBe("JPY");
    // Europe as the ladder defines it is the 32, not the continent: a code outside them is not
    // European even when its geography is (the catch-all region of AC-2).
    expect(isEuropean("RS")).toBe(false);
    expect(regionOf("RS")).toBe("asia_pacific");
    expect(isEuropean("US")).toBe(false);
  });

  it("answers for an unknown code without throwing", () => {
    expect(isCountryCode("CH")).toBe(true);
    expect(isCountryCode("US")).toBe(true);
    expect(isCountryCode("ch")).toBe(false);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
    expect(regionOf("ZZ")).toBeNull();
    expect(currencyOf("ZZ")).toBeNull();
    expect(isEuropean(null)).toBe(false);
    expect(isEuropean(undefined)).toBe(false);
    expect(regionCountriesOf("ZZ")).toEqual([]);
  });

  it("lists a region's countries including the code itself (AC-5, AC-26)", () => {
    const dach = regionCountriesOf("CH");
    expect(dach).toEqual(["CH", "DE", "AT", "LI"]);
    expect(regionCountriesOf("DE")).toEqual(dach);
    expect(regionCountriesOf("US")).toContain("US");
    expect(regionCountriesOf("US")).toContain("CA");
    expect(regionCountriesOf("US")).not.toContain("BR");
    // Every code's region list is exactly the codes sharing its region.
    for (const country of COUNTRIES) {
      const peers = regionCountriesOf(country.code);
      expect(peers, country.code).toContain(country.code);
      for (const peer of peers) expect(regionOf(peer), peer).toBe(country.region);
    }
  });

  it("names a country in both locales through Intl.DisplayNames", () => {
    expect(countryName("CH", "en")).toBe("Switzerland");
    expect(countryName("CH", "de")).toBe("Schweiz");
    expect(countryName("DE", "en")).toBe("Germany");
    expect(countryName("BR", "en")).toBe("Brazil");
    // An unknown code falls back to the code itself rather than throwing.
    expect(countryName("ZZ", "en")).toMatch(/^(ZZ|Unknown Region)$/);
  });
});
