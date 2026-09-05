import { defineRouting } from "next-intl/routing";
import { PATHNAMES } from "./pathnames";

/**
 * The next-intl locales (spec 0004): region aware tags so numbers, dates and CHF format the Swiss
 * way in both languages. This is what next-intl formats with, what `html lang` shows and what the
 * `NEXT_LOCALE` cookie stores.
 */
export const LOCALES = ["de-CH", "en-CH"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * The short language code per locale: what the database stores (`profiles.locale`,
 * `organizations.locale`, the `kpi_definitions` jsonb keys) and what the URL prefix is. Only this
 * table and `localeFromCode` translate between the two spellings; nothing else hardcodes either.
 */
export const LOCALE_CODE = { "de-CH": "de", "en-CH": "en" } as const satisfies Record<
  Locale,
  string
>;
export type LocaleCode = (typeof LOCALE_CODE)[Locale];

/** The default locale, English (spec 0001 amended 2026-09-05; German until then). */
export const DEFAULT_LOCALE: Locale = "en-CH";

/** True when `value` is one of the app locales (`de-CH`, `en-CH`). Pure, runs anywhere. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The app locale for a route param or form value, the default when it is not one. Pure, runs anywhere. */
export function resolveLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/** Turns a stored short code or URL prefix into the next-intl locale; an unknown code gives the default. Pure, runs anywhere. */
export function localeFromCode(code: string | null | undefined): Locale {
  const match = LOCALES.find((locale) => LOCALE_CODE[locale] === code);
  return match ?? DEFAULT_LOCALE;
}

// Spec 0001: locale prefix always, default English (amended 2026-09-05), no browser language detection, an explicit
// switcher writes the locale cookie. Spec 0004: the prefix is the short code, derived from
// `LOCALE_CODE`, so `localeFromCode(prefix)` also serves the proxy; `localizedAlternates` in
// `metadata.ts` is the single authority for language links, so the middleware sends none.
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: {
    mode: "always",
    prefixes: { "de-CH": `/${LOCALE_CODE["de-CH"]}`, "en-CH": `/${LOCALE_CODE["en-CH"]}` },
  },
  localeDetection: false,
  localeCookie: { name: "NEXT_LOCALE" },
  alternateLinks: false,
  pathnames: PATHNAMES,
});
