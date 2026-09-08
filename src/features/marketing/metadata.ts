import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { absoluteUrl, localizedAlternates } from "@/i18n/metadata";
import type { StaticPathname } from "@/i18n/pathnames";
import { LOCALES, type Locale } from "@/i18n/routing";

/** The marketing pages and their typed routes (spec 0009, AC-1). */
export const MARKETING_PAGES = {
  landing: "/",
  howItWorks: "/how-it-works",
  expertNetwork: "/expert-network",
  directory: "/expert-network/directory",
  pricing: "/pricing",
  about: "/about",
  contact: "/contact",
  privacy: "/privacy",
  terms: "/terms",
  imprint: "/imprint",
  cookies: "/cookies",
} as const satisfies Record<string, StaticPathname>;

export type MarketingPage = keyof typeof MARKETING_PAGES;

/**
 * The catalogue root holding a page's copy (spec 0015, AC-6). Most pages live under `marketing`;
 * the four legal pages live under `legalPages`, because their copy is long legal text and must
 * stay out of `legal`, which `clientMessages` ships to every client bundle for the cookie bar. A
 * page absent from this map uses `marketing`, so adding a marketing page is still a one line edit.
 */
const PAGE_NAMESPACE = {
  privacy: "legalPages.privacy",
  terms: "legalPages.terms",
  imprint: "legalPages.imprint",
  cookies: "legalPages.cookiesPage",
} as const satisfies Partial<Record<MarketingPage, string>>;

/** The dotted catalogue path of a page's copy (`marketing.about`, `legal.privacy`). Pure. */
export function pageNamespace<P extends MarketingPage>(
  page: P,
): P extends keyof typeof PAGE_NAMESPACE ? (typeof PAGE_NAMESPACE)[P] : `marketing.${P}` {
  return ((PAGE_NAMESPACE as Partial<Record<MarketingPage, string>>)[page] ??
    `marketing.${page}`) as P extends keyof typeof PAGE_NAMESPACE
    ? (typeof PAGE_NAMESPACE)[P]
    : `marketing.${P}`;
}

/** The Open Graph locale tag of an app locale (`de_CH`). Pure. */
export function openGraphLocale(locale: Locale): string {
  return locale.replace("-", "_");
}

/**
 * The metadata of one marketing page in one language (spec 0009, AC-1, AC-2): the localized
 * title and description from the page's `<namespace>.meta.*`, the canonical URL and the language
 * alternates, and the Open Graph and Twitter fields. The image tags come from the page's
 * `opengraph-image.tsx`, which Next merges in with a higher priority. Server, `generateMetadata`.
 */
export async function marketingMetadata(page: MarketingPage, locale: Locale): Promise<Metadata> {
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: `${pageNamespace(page)}.meta` }),
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
