/**
 * The world country catalogue (spec 0022, AC-2; spec 0021 AC-1 for the European half): every ISO
 * 3166 alpha 2 code with its region for the peer and expert ladders and its currency for the loss
 * model. A constant, not a table. Pure, runs anywhere.
 */

/** The six European regions of the ladder's second rung (spec 0021, rationale "The region map"). */
export const EUROPEAN_REGIONS = [
  "dach",
  "nordics",
  "benelux",
  "british_isles",
  "southern",
  "central_eastern",
] as const;
export type EuropeanRegion = (typeof EUROPEAN_REGIONS)[number];

/** The four regions the rest of the world is grouped into (spec 0022, AC-2). */
export const WORLD_REGIONS = [
  "north_america",
  "latin_america",
  "middle_east_africa",
  "asia_pacific",
] as const;

/** Every region: the six European ones first, so the Europe first grouping reads in order. */
export const REGIONS = [...EUROPEAN_REGIONS, ...WORLD_REGIONS] as const;
export type Region = (typeof REGIONS)[number];

export type Country = {
  readonly code: string;
  readonly region: Region;
  /** The ISO 4217 code money is priced in for a client of this country (spec 0022, AC-14). */
  readonly currency: string;
};

/**
 * Every ISO 3166 alpha 2 code, the 32 European ones first in the region map's order, then the
 * rest of the world grouped into the four regions of AC-2. A code that is geographically European
 * but outside the product's 32 (Andorra, Serbia, Ukraine, the Channel Islands) sits in
 * `asia_pacific`, the catch-all: the six European regions keep exactly the members spec 0021 gave
 * them, so `isEuropean` stays the ladder's Europe rung and not a continent test.
 */
export const COUNTRIES: readonly Country[] = [
  // The EU 27 plus CH, LI, NO, IS and GB (spec 0021, AC-1).
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
  // The rest of the world (AC-2): North America.
  { code: "BM", region: "north_america", currency: "BMD" },
  { code: "CA", region: "north_america", currency: "CAD" },
  { code: "GL", region: "north_america", currency: "DKK" },
  { code: "PM", region: "north_america", currency: "EUR" },
  { code: "US", region: "north_america", currency: "USD" },
  // Latin America and the Caribbean.
  { code: "AG", region: "latin_america", currency: "XCD" },
  { code: "AI", region: "latin_america", currency: "XCD" },
  { code: "AR", region: "latin_america", currency: "ARS" },
  { code: "AW", region: "latin_america", currency: "AWG" },
  { code: "BB", region: "latin_america", currency: "BBD" },
  { code: "BL", region: "latin_america", currency: "EUR" },
  { code: "BO", region: "latin_america", currency: "BOB" },
  { code: "BQ", region: "latin_america", currency: "USD" },
  { code: "BR", region: "latin_america", currency: "BRL" },
  { code: "BS", region: "latin_america", currency: "BSD" },
  { code: "BZ", region: "latin_america", currency: "BZD" },
  { code: "CL", region: "latin_america", currency: "CLP" },
  { code: "CO", region: "latin_america", currency: "COP" },
  { code: "CR", region: "latin_america", currency: "CRC" },
  { code: "CU", region: "latin_america", currency: "CUP" },
  { code: "CW", region: "latin_america", currency: "XCG" },
  { code: "DM", region: "latin_america", currency: "XCD" },
  { code: "DO", region: "latin_america", currency: "DOP" },
  { code: "EC", region: "latin_america", currency: "USD" },
  { code: "FK", region: "latin_america", currency: "FKP" },
  { code: "GD", region: "latin_america", currency: "XCD" },
  { code: "GF", region: "latin_america", currency: "EUR" },
  { code: "GP", region: "latin_america", currency: "EUR" },
  { code: "GS", region: "latin_america", currency: "GBP" },
  { code: "GT", region: "latin_america", currency: "GTQ" },
  { code: "GY", region: "latin_america", currency: "GYD" },
  { code: "HN", region: "latin_america", currency: "HNL" },
  { code: "HT", region: "latin_america", currency: "HTG" },
  { code: "JM", region: "latin_america", currency: "JMD" },
  { code: "KN", region: "latin_america", currency: "XCD" },
  { code: "KY", region: "latin_america", currency: "KYD" },
  { code: "LC", region: "latin_america", currency: "XCD" },
  { code: "MF", region: "latin_america", currency: "EUR" },
  { code: "MQ", region: "latin_america", currency: "EUR" },
  { code: "MS", region: "latin_america", currency: "XCD" },
  { code: "MX", region: "latin_america", currency: "MXN" },
  { code: "NI", region: "latin_america", currency: "NIO" },
  { code: "PA", region: "latin_america", currency: "PAB" },
  { code: "PE", region: "latin_america", currency: "PEN" },
  { code: "PR", region: "latin_america", currency: "USD" },
  { code: "PY", region: "latin_america", currency: "PYG" },
  { code: "SR", region: "latin_america", currency: "SRD" },
  { code: "SV", region: "latin_america", currency: "USD" },
  { code: "SX", region: "latin_america", currency: "XCG" },
  { code: "TC", region: "latin_america", currency: "USD" },
  { code: "TT", region: "latin_america", currency: "TTD" },
  { code: "UY", region: "latin_america", currency: "UYU" },
  { code: "VC", region: "latin_america", currency: "XCD" },
  { code: "VE", region: "latin_america", currency: "VES" },
  { code: "VG", region: "latin_america", currency: "USD" },
  { code: "VI", region: "latin_america", currency: "USD" },
  // The Middle East and Africa.
  { code: "AE", region: "middle_east_africa", currency: "AED" },
  { code: "AO", region: "middle_east_africa", currency: "AOA" },
  { code: "BF", region: "middle_east_africa", currency: "XOF" },
  { code: "BH", region: "middle_east_africa", currency: "BHD" },
  { code: "BI", region: "middle_east_africa", currency: "BIF" },
  { code: "BJ", region: "middle_east_africa", currency: "XOF" },
  { code: "BW", region: "middle_east_africa", currency: "BWP" },
  { code: "CD", region: "middle_east_africa", currency: "CDF" },
  { code: "CF", region: "middle_east_africa", currency: "XAF" },
  { code: "CG", region: "middle_east_africa", currency: "XAF" },
  { code: "CI", region: "middle_east_africa", currency: "XOF" },
  { code: "CM", region: "middle_east_africa", currency: "XAF" },
  { code: "CV", region: "middle_east_africa", currency: "CVE" },
  { code: "DJ", region: "middle_east_africa", currency: "DJF" },
  { code: "DZ", region: "middle_east_africa", currency: "DZD" },
  { code: "EG", region: "middle_east_africa", currency: "EGP" },
  { code: "EH", region: "middle_east_africa", currency: "MAD" },
  { code: "ER", region: "middle_east_africa", currency: "ERN" },
  { code: "ET", region: "middle_east_africa", currency: "ETB" },
  { code: "GA", region: "middle_east_africa", currency: "XAF" },
  { code: "GH", region: "middle_east_africa", currency: "GHS" },
  { code: "GM", region: "middle_east_africa", currency: "GMD" },
  { code: "GN", region: "middle_east_africa", currency: "GNF" },
  { code: "GQ", region: "middle_east_africa", currency: "XAF" },
  { code: "GW", region: "middle_east_africa", currency: "XOF" },
  { code: "IL", region: "middle_east_africa", currency: "ILS" },
  { code: "IQ", region: "middle_east_africa", currency: "IQD" },
  { code: "IR", region: "middle_east_africa", currency: "IRR" },
  { code: "JO", region: "middle_east_africa", currency: "JOD" },
  { code: "KE", region: "middle_east_africa", currency: "KES" },
  { code: "KM", region: "middle_east_africa", currency: "KMF" },
  { code: "KW", region: "middle_east_africa", currency: "KWD" },
  { code: "LB", region: "middle_east_africa", currency: "LBP" },
  { code: "LR", region: "middle_east_africa", currency: "LRD" },
  { code: "LS", region: "middle_east_africa", currency: "LSL" },
  { code: "LY", region: "middle_east_africa", currency: "LYD" },
  { code: "MA", region: "middle_east_africa", currency: "MAD" },
  { code: "MG", region: "middle_east_africa", currency: "MGA" },
  { code: "ML", region: "middle_east_africa", currency: "XOF" },
  { code: "MR", region: "middle_east_africa", currency: "MRU" },
  { code: "MU", region: "middle_east_africa", currency: "MUR" },
  { code: "MW", region: "middle_east_africa", currency: "MWK" },
  { code: "MZ", region: "middle_east_africa", currency: "MZN" },
  { code: "NA", region: "middle_east_africa", currency: "NAD" },
  { code: "NE", region: "middle_east_africa", currency: "XOF" },
  { code: "NG", region: "middle_east_africa", currency: "NGN" },
  { code: "OM", region: "middle_east_africa", currency: "OMR" },
  { code: "PS", region: "middle_east_africa", currency: "ILS" },
  { code: "QA", region: "middle_east_africa", currency: "QAR" },
  { code: "RE", region: "middle_east_africa", currency: "EUR" },
  { code: "RW", region: "middle_east_africa", currency: "RWF" },
  { code: "SA", region: "middle_east_africa", currency: "SAR" },
  { code: "SC", region: "middle_east_africa", currency: "SCR" },
  { code: "SD", region: "middle_east_africa", currency: "SDG" },
  { code: "SH", region: "middle_east_africa", currency: "SHP" },
  { code: "SL", region: "middle_east_africa", currency: "SLE" },
  { code: "SN", region: "middle_east_africa", currency: "XOF" },
  { code: "SO", region: "middle_east_africa", currency: "SOS" },
  { code: "SS", region: "middle_east_africa", currency: "SSP" },
  { code: "ST", region: "middle_east_africa", currency: "STN" },
  { code: "SY", region: "middle_east_africa", currency: "SYP" },
  { code: "SZ", region: "middle_east_africa", currency: "SZL" },
  { code: "TD", region: "middle_east_africa", currency: "XAF" },
  { code: "TG", region: "middle_east_africa", currency: "XOF" },
  { code: "TN", region: "middle_east_africa", currency: "TND" },
  { code: "TR", region: "middle_east_africa", currency: "TRY" },
  { code: "TZ", region: "middle_east_africa", currency: "TZS" },
  { code: "UG", region: "middle_east_africa", currency: "UGX" },
  { code: "YE", region: "middle_east_africa", currency: "YER" },
  { code: "YT", region: "middle_east_africa", currency: "EUR" },
  { code: "ZA", region: "middle_east_africa", currency: "ZAR" },
  { code: "ZM", region: "middle_east_africa", currency: "ZMW" },
  { code: "ZW", region: "middle_east_africa", currency: "ZWG" },
  // Asia Pacific, and every code the three regions above do not claim.
  { code: "AD", region: "asia_pacific", currency: "EUR" },
  { code: "AF", region: "asia_pacific", currency: "AFN" },
  { code: "AL", region: "asia_pacific", currency: "ALL" },
  { code: "AM", region: "asia_pacific", currency: "AMD" },
  { code: "AQ", region: "asia_pacific", currency: "USD" },
  { code: "AS", region: "asia_pacific", currency: "USD" },
  { code: "AU", region: "asia_pacific", currency: "AUD" },
  { code: "AX", region: "asia_pacific", currency: "EUR" },
  { code: "AZ", region: "asia_pacific", currency: "AZN" },
  { code: "BA", region: "asia_pacific", currency: "BAM" },
  { code: "BD", region: "asia_pacific", currency: "BDT" },
  { code: "BN", region: "asia_pacific", currency: "BND" },
  { code: "BT", region: "asia_pacific", currency: "BTN" },
  { code: "BV", region: "asia_pacific", currency: "NOK" },
  { code: "BY", region: "asia_pacific", currency: "BYN" },
  { code: "CC", region: "asia_pacific", currency: "AUD" },
  { code: "CK", region: "asia_pacific", currency: "NZD" },
  { code: "CN", region: "asia_pacific", currency: "CNY" },
  { code: "CX", region: "asia_pacific", currency: "AUD" },
  { code: "FJ", region: "asia_pacific", currency: "FJD" },
  { code: "FM", region: "asia_pacific", currency: "USD" },
  { code: "FO", region: "asia_pacific", currency: "DKK" },
  { code: "GE", region: "asia_pacific", currency: "GEL" },
  { code: "GG", region: "asia_pacific", currency: "GBP" },
  { code: "GI", region: "asia_pacific", currency: "GIP" },
  { code: "GU", region: "asia_pacific", currency: "USD" },
  { code: "HK", region: "asia_pacific", currency: "HKD" },
  { code: "HM", region: "asia_pacific", currency: "AUD" },
  { code: "ID", region: "asia_pacific", currency: "IDR" },
  { code: "IM", region: "asia_pacific", currency: "GBP" },
  { code: "IN", region: "asia_pacific", currency: "INR" },
  { code: "IO", region: "asia_pacific", currency: "USD" },
  { code: "JE", region: "asia_pacific", currency: "GBP" },
  { code: "JP", region: "asia_pacific", currency: "JPY" },
  { code: "KG", region: "asia_pacific", currency: "KGS" },
  { code: "KH", region: "asia_pacific", currency: "KHR" },
  { code: "KI", region: "asia_pacific", currency: "AUD" },
  { code: "KP", region: "asia_pacific", currency: "KPW" },
  { code: "KR", region: "asia_pacific", currency: "KRW" },
  { code: "KZ", region: "asia_pacific", currency: "KZT" },
  { code: "LA", region: "asia_pacific", currency: "LAK" },
  { code: "LK", region: "asia_pacific", currency: "LKR" },
  { code: "MC", region: "asia_pacific", currency: "EUR" },
  { code: "MD", region: "asia_pacific", currency: "MDL" },
  { code: "ME", region: "asia_pacific", currency: "EUR" },
  { code: "MH", region: "asia_pacific", currency: "USD" },
  { code: "MK", region: "asia_pacific", currency: "MKD" },
  { code: "MM", region: "asia_pacific", currency: "MMK" },
  { code: "MN", region: "asia_pacific", currency: "MNT" },
  { code: "MO", region: "asia_pacific", currency: "MOP" },
  { code: "MP", region: "asia_pacific", currency: "USD" },
  { code: "MV", region: "asia_pacific", currency: "MVR" },
  { code: "MY", region: "asia_pacific", currency: "MYR" },
  { code: "NC", region: "asia_pacific", currency: "XPF" },
  { code: "NF", region: "asia_pacific", currency: "AUD" },
  { code: "NP", region: "asia_pacific", currency: "NPR" },
  { code: "NR", region: "asia_pacific", currency: "AUD" },
  { code: "NU", region: "asia_pacific", currency: "NZD" },
  { code: "NZ", region: "asia_pacific", currency: "NZD" },
  { code: "PF", region: "asia_pacific", currency: "XPF" },
  { code: "PG", region: "asia_pacific", currency: "PGK" },
  { code: "PH", region: "asia_pacific", currency: "PHP" },
  { code: "PK", region: "asia_pacific", currency: "PKR" },
  { code: "PN", region: "asia_pacific", currency: "NZD" },
  { code: "PW", region: "asia_pacific", currency: "USD" },
  { code: "RS", region: "asia_pacific", currency: "RSD" },
  { code: "RU", region: "asia_pacific", currency: "RUB" },
  { code: "SB", region: "asia_pacific", currency: "SBD" },
  { code: "SG", region: "asia_pacific", currency: "SGD" },
  { code: "SJ", region: "asia_pacific", currency: "NOK" },
  { code: "SM", region: "asia_pacific", currency: "EUR" },
  { code: "TF", region: "asia_pacific", currency: "EUR" },
  { code: "TH", region: "asia_pacific", currency: "THB" },
  { code: "TJ", region: "asia_pacific", currency: "TJS" },
  { code: "TK", region: "asia_pacific", currency: "NZD" },
  { code: "TL", region: "asia_pacific", currency: "USD" },
  { code: "TM", region: "asia_pacific", currency: "TMT" },
  { code: "TO", region: "asia_pacific", currency: "TOP" },
  { code: "TV", region: "asia_pacific", currency: "AUD" },
  { code: "TW", region: "asia_pacific", currency: "TWD" },
  { code: "UA", region: "asia_pacific", currency: "UAH" },
  { code: "UM", region: "asia_pacific", currency: "USD" },
  { code: "UZ", region: "asia_pacific", currency: "UZS" },
  { code: "VA", region: "asia_pacific", currency: "EUR" },
  { code: "VN", region: "asia_pacific", currency: "VND" },
  { code: "VU", region: "asia_pacific", currency: "VUV" },
  { code: "WF", region: "asia_pacific", currency: "XPF" },
  { code: "WS", region: "asia_pacific", currency: "WST" },
];

/** The codes as a tuple, for `z.enum`. */
export const COUNTRY_CODES = COUNTRIES.map((country) => country.code) as [string, ...string[]];

const BY_CODE: ReadonlyMap<string, Country> = new Map(
  COUNTRIES.map((country) => [country.code, country]),
);

/** True when `value` is an ISO 3166 alpha 2 code the catalogue knows. Pure. */
export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && BY_CODE.has(value);
}

/** The region of a code, `null` for anything not an ISO 3166 alpha 2 code. Pure. */
export function regionOf(code: string | null | undefined): Region | null {
  return (code === null || code === undefined ? undefined : BY_CODE.get(code))?.region ?? null;
}

/**
 * Every code sharing a region with this one, the code itself included; empty for a code outside
 * the catalogue. The peer search and `expert_suggestions` take it as the ladder's second rung
 * (AC-5, AC-26). Pure.
 */
export function regionCountriesOf(code: string | null | undefined): readonly string[] {
  const region = regionOf(code);
  if (region === null) return [];
  return COUNTRIES.filter((country) => country.region === region).map((country) => country.code);
}

/**
 * True for one of the 32 codes of the six European regions: the ladder's Europe rung and the
 * Europe first grouping of the country select (AC-1). Geographically European codes outside those
 * 32 answer false, as the ladder defines Europe. Pure.
 */
export function isEuropean(code: string | null | undefined): boolean {
  const region = regionOf(code);
  return region !== null && (EUROPEAN_REGIONS as readonly string[]).includes(region);
}

/** The currency of a code, `null` for a code outside the catalogue. Pure. */
export function currencyOf(code: string | null | undefined): string | null {
  return (code === null || code === undefined ? undefined : BY_CODE.get(code))?.currency ?? null;
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
