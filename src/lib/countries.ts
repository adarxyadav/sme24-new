/**
 * The country catalogue (spec 0021, AC-1; spec 0020 consumes it): the 32 European codes the
 * product knows, each with its region for the peer ladder and its currency for the cost model.
 * A constant, not a table. Pure, runs anywhere.
 */

/** The six regions of the peer ladder's second rung (spec 0021, rationale "The region map"). */
export const REGIONS = [
  "dach",
  "nordics",
  "benelux",
  "british_isles",
  "southern",
  "central_eastern",
] as const;
export type Region = (typeof REGIONS)[number];

export type Country = {
  readonly code: string;
  readonly region: Region;
  /** The ISO 4217 code money is priced in for a client of this country (spec 0020). */
  readonly currency: string;
};

/** The EU 27 plus CH, LI, NO, IS and GB, in the region map's order. */
export const COUNTRIES: readonly Country[] = [
  { code: "CH", region: "dach", currency: "CHF" },
  { code: "DE", region: "dach", currency: "EUR" },
  { code: "AT", region: "dach", currency: "EUR" },
  { code: "LI", region: "dach", currency: "CHF" },
  { code: "DK", region: "nordics", currency: "DKK" },
  { code: "FI", region: "nordics", currency: "EUR" },
  { code: "IS", region: "nordics", currency: "ISK" },
  { code: "NO", region: "nordics", currency: "NOK" },
  { code: "SE", region: "nordics", currency: "SEK" },
  { code: "BE", region: "benelux", currency: "EUR" },
  { code: "NL", region: "benelux", currency: "EUR" },
  { code: "LU", region: "benelux", currency: "EUR" },
  { code: "GB", region: "british_isles", currency: "GBP" },
  { code: "IE", region: "british_isles", currency: "EUR" },
  { code: "FR", region: "southern", currency: "EUR" },
  { code: "IT", region: "southern", currency: "EUR" },
  { code: "ES", region: "southern", currency: "EUR" },
  { code: "PT", region: "southern", currency: "EUR" },
  { code: "GR", region: "southern", currency: "EUR" },
  { code: "MT", region: "southern", currency: "EUR" },
  { code: "CY", region: "southern", currency: "EUR" },
  { code: "PL", region: "central_eastern", currency: "PLN" },
  { code: "CZ", region: "central_eastern", currency: "CZK" },
  { code: "SK", region: "central_eastern", currency: "EUR" },
  { code: "HU", region: "central_eastern", currency: "HUF" },
  { code: "RO", region: "central_eastern", currency: "RON" },
  // The euro since 1 January 2026 (spec 0020, AC-1).
  { code: "BG", region: "central_eastern", currency: "EUR" },
  { code: "HR", region: "central_eastern", currency: "EUR" },
  { code: "SI", region: "central_eastern", currency: "EUR" },
  { code: "EE", region: "central_eastern", currency: "EUR" },
  { code: "LV", region: "central_eastern", currency: "EUR" },
  { code: "LT", region: "central_eastern", currency: "EUR" },
];

/** The codes as a tuple, for `z.enum`. */
export const COUNTRY_CODES = COUNTRIES.map((country) => country.code) as [string, ...string[]];

/** True when `value` is one of the catalogue's codes. Pure. */
export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && COUNTRIES.some((country) => country.code === value);
}

/** The region of a catalogue code, `null` for a code outside the catalogue. Pure. */
export function regionOf(code: string | null | undefined): Region | null {
  return COUNTRIES.find((country) => country.code === code)?.region ?? null;
}

/** True for a code in the catalogue: the catalogue is Europe as the ladder's third rung defines it. Pure. */
export function isEuropean(code: string | null | undefined): boolean {
  return regionOf(code) !== null;
}

/** The currency of a catalogue code, `null` for a code outside the catalogue. Pure. */
export function currencyOf(code: string | null | undefined): string | null {
  return COUNTRIES.find((country) => country.code === code)?.currency ?? null;
}

/** The catalog tag `Intl.DisplayNames` reads for each short locale. */
const DISPLAY_LOCALE = { de: "de-CH", en: "en-CH" } as const;

/**
 * The country's name in the page locale through `Intl.DisplayNames`, so no per country message
 * key exists; falls back to the code itself when the runtime has no name for it. Pure.
 */
export function countryName(code: string, locale: "de" | "en"): string {
  try {
    return new Intl.DisplayNames([DISPLAY_LOCALE[locale]], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
