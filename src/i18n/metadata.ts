import type { Metadata } from "next";
import { getPathname } from "@/i18n/navigation";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "@/i18n/routing";
import { clientEnv } from "@/lib/env";

/** A typed route, with parameters when the route has them: what `getPathname` accepts as `href`. */
export type LocalizedHref = Parameters<typeof getPathname>[0]["href"];

/** The `alternates` object of a page: canonical plus one URL per language and `x-default`. */
export type LocalizedAlternates = {
  readonly canonical: string;
  readonly languages: Readonly<Record<Locale | "x-default", string>>;
};

/** The absolute URL of a typed route in one locale, resolving localised slugs through the pathnames map. Pure, runs anywhere. */
export function absoluteUrl(href: LocalizedHref, locale: Locale): string {
  return new URL(getPathname({ href, locale }), clientEnv().NEXT_PUBLIC_APP_URL).toString();
}

/**
 * Language alternates for a route (spec 0004, AC-10): the canonical URL of the current locale plus
 * `de-CH`, `en-CH` and `x-default` (German) links, with absolute URLs from `NEXT_PUBLIC_APP_URL`.
 * Pages spread it into `alternates` in `generateMetadata`; the sitemap uses the same `languages`.
 * Pure, runs on the server.
 */
export function localizedAlternates(href: LocalizedHref, locale: Locale): LocalizedAlternates {
  const languages = Object.fromEntries(
    LOCALES.map((target) => [target, absoluteUrl(href, target)]),
  ) as Record<Locale, string>;
  return {
    canonical: languages[locale],
    languages: { ...languages, "x-default": languages[DEFAULT_LOCALE] },
  };
}

/** `localizedAlternates` shaped for Next's `Metadata`, so a page can spread it in one line. Server. */
export function alternatesMetadata(
  href: LocalizedHref,
  locale: Locale,
): Pick<Metadata, "alternates"> {
  return { alternates: localizedAlternates(href, locale) };
}
