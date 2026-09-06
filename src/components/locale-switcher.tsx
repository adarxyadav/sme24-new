"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/features/localization/actions";
import { Link, usePathname } from "@/i18n/navigation";
import { type Query, searchParamsToQuery } from "@/i18n/query";
import { LOCALE_CODE, type Locale, routing } from "@/i18n/routing";

const LABEL_KEY = { "de-CH": "german", "en-CH": "english" } as const satisfies Record<
  Locale,
  string
>;

/**
 * Explicit language switch as a dropdown: a trigger the height of the theme pill showing the
 * current language, and a menu with one item per locale, each a real link so the switch keeps the
 * path, the query string and the middle click. next-intl writes the locale cookie on the change
 * (spec 0001). The marketing pages are prerendered, and reading the search params would bail the
 * tree out of prerendering, so the query aware menu sits behind a Suspense boundary whose fallback
 * renders the same menu without the query. Each link also starts `setLocale` without awaiting it
 * (spec 0004, AC-2): persistence here is best effort and the page never depends on the stored
 * value. Runs in the browser.
 */
export function LocaleSwitcher() {
  return (
    <Suspense fallback={<LocaleMenu />}>
      <LocaleMenuWithQuery />
    </Suspense>
  );
}

function LocaleMenuWithQuery() {
  const query = searchParamsToQuery(useSearchParams());
  return <LocaleMenu query={query} />;
}

function LocaleMenu({ query }: { query?: Query }) {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const params = useParams();
  // The current pathname and params always match (a dynamic route such as `/admin/emails/[id]`
  // carries its `id`), so the pair is handed on as is; TypeScript cannot see that they belong
  // together, which is next-intl's documented reason for the expect error below.
  const href = { pathname, params, ...(query ? { query } : {}) };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // The trigger's visible text is the language name, so the accessible name has to contain
        // it (WCAG 2.5.3, Label in Name): "Language: English", never a bare "Language" that would
        // replace it. axe cannot catch a regression here -- `label-content-name-mismatch` ships
        // disabled as experimental, so `WCAG_TAGS` never runs it; the unit test is the guard.
        aria-label={t("languageNamed", { language: t(LABEL_KEY[locale]) })}
        className="inline-flex h-[34px] items-center gap-1 rounded-full border bg-background pr-2.5 pl-3 text-muted-foreground text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-open:text-foreground"
      >
        {t(LABEL_KEY[locale])}
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3.5 transition-transform data-open:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-auto min-w-(--radix-dropdown-menu-trigger-width)"
      >
        {routing.locales.map((target) => {
          const active = target === locale;
          return (
            <DropdownMenuItem key={target} asChild>
              <Link
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
                className="justify-between"
              >
                {t(LABEL_KEY[target])}
                {active ? <CheckIcon aria-hidden="true" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
