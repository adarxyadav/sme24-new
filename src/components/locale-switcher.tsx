"use client";

import { useParams, useSearchParams } from "next/navigation";
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
  const params = useParams();
  // The current pathname and params always match (a dynamic route such as `/admin/emails/[id]`
  // carries its `id`), so the pair is handed on as is; TypeScript cannot see that they belong
  // together, which is next-intl's documented reason for the expect error below.
  const href = { pathname, params, ...(query ? { query } : {}) };

  return (
    <nav aria-label={t("language")} className="flex items-center gap-2 text-sm">
      {routing.locales.map((target) => {
        const active = target === locale;
        return (
          <Link
            key={target}
            // @ts-expect-error -- pathname and params come from the current route and match (see above).
            href={href}
            locale={target}
            hrefLang={target}
            lang={target}
            aria-current={active ? "true" : undefined}
            onClick={() => {
              setLocale({ locale: LOCALE_CODE[target] }).catch(() => {
                // Best effort: the link carries the switch, a lost write is not an error.
              });
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
