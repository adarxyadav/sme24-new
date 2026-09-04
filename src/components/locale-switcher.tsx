"use client";

import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";
import { setLocale } from "@/features/localization/actions";
import { Link, usePathname } from "@/i18n/navigation";
import { type Query, searchParamsToQuery } from "@/i18n/query";
import { LOCALE_CODE, type Locale, routing } from "@/i18n/routing";

const LABEL_KEY = { "de-CH": "german", "en-CH": "english" } as const satisfies Record<
  Locale,
  string
>;

/**
 * Explicit language switch; next-intl writes the locale cookie on the change (spec 0001). The
 * marketing pages are prerendered, and reading the search params would bail the tree out of
 * prerendering, so the query aware links sit behind a Suspense boundary whose fallback renders
 * the same links without the query: the static HTML carries the switcher, the browser then swaps
 * in the version that keeps the query string. Each link also starts `setLocale` without awaiting
 * it (spec 0004, AC-2): persistence here is best effort, the link works without JavaScript and the
 * page never depends on the stored value. Runs in the browser.
 */
export function LocaleSwitcher() {
  return (
    <Suspense fallback={<LocaleLinks />}>
      <LocaleLinksWithQuery />
    </Suspense>
  );
}

function LocaleLinksWithQuery() {
  const query = searchParamsToQuery(useSearchParams());
  return <LocaleLinks query={query} />;
}

function LocaleLinks({ query }: { query?: Query }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const href = query ? { pathname, query } : pathname;

  return (
    <nav aria-label={t("language")} className="flex items-center gap-2 text-sm">
      {routing.locales.map((target) => {
        const active = target === locale;
        return (
          <Link
            key={target}
            href={href}
            locale={target}
            hrefLang={target}
            lang={target}
            aria-current={active ? "true" : undefined}
            onClick={() => {
              void setLocale({ locale: LOCALE_CODE[target] });
            }}
            className={
              active
                ? "rounded-md bg-foreground px-2 py-1 font-medium text-background"
                : "rounded-md px-2 py-1 text-muted-foreground underline-offset-4 hover:underline"
            }
          >
            {t(LABEL_KEY[target])}
          </Link>
        );
      })}
    </nav>
  );
}
