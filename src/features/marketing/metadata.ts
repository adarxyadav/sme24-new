import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { absoluteUrl, localizedAlternates } from "@/i18n/metadata";
import type { StaticPathname } from "@/i18n/pathnames";
import { LOCALES, type Locale } from "@/i18n/routing";

/** The marketing pages and their typed routes (spec 0009, AC-1). */
export const MARKETING_PAGES = {
  landing: "/",
  pricing: "/pricing",
  about: "/about",
  contact: "/contact",
} as const satisfies Record<string, StaticPathname>;

export type MarketingPage = keyof typeof MARKETING_PAGES;

/** The Open Graph locale tag of an app locale (`de_CH`). Pure. */
export function openGraphLocale(locale: Locale): string {
  return locale.replace("-", "_");
}

/**
 * The metadata of one marketing page in one language (spec 0009, AC-1, AC-2): the localized
 * title and description from `marketing.<page>.meta.*`, the canonical URL and the language
 * alternates, and the Open Graph and Twitter fields. The image tags come from the page's
 * `opengraph-image.tsx`, which Next merges in with a higher priority. Server, `generateMetadata`.
 */
export async function marketingMetadata(page: MarketingPage, locale: Locale): Promise<Metadata> {
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: `marketing.${page}.meta` }),
    getTranslations({ locale, namespace: "common" }),
  ]);
  const route = MARKETING_PAGES[page];
  const title = t("title");
  const description = t("description");
  const url = absoluteUrl(route, locale);
  return {
    title,
    description,
    alternates: localizedAlternates(route, locale),
    openGraph: {
      type: "website",
      siteName: common("appName"),
      locale: openGraphLocale(locale),
      alternateLocale: LOCALES.filter((other) => other !== locale).map(openGraphLocale),
      url,
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}
