"use client";

import { LanguagesIcon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocale } from "@/features/localization/actions";
import { usePathname, useRouter } from "@/i18n/navigation";
import { searchParamsToQuery } from "@/i18n/query";
import { LOCALE_CODE, type Locale, routing } from "@/i18n/routing";

const LABEL_KEY = { "de-CH": "german", "en-CH": "english" } as const satisfies Record<
  Locale,
  string
>;

/**
 * Language submenu for the sidebar user menu: one radio item per locale that stores the choice on
 * the profile through `setLocale` (spec 0004, AC-2) and then replaces the current page with the
 * same page (path and query string) in the other language (next-intl writes the locale cookie on
 * the change, spec 0001). The write is awaited so the navigation does not cut it off. Runs in the
 * browser inside a `DropdownMenuContent`, in the signed in areas only, which render dynamically,
 * so reading the search params never bails out of prerendering.
 */
export function LocaleMenuItems() {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();
  const query = searchParamsToQuery(useSearchParams());
  const router = useRouter();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <LanguagesIcon aria-hidden="true" />
        {t("language")}
        <span className="ml-auto text-muted-foreground text-xs">{t(LABEL_KEY[locale])}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={locale}>
          {routing.locales.map((target) => (
            <DropdownMenuRadioItem
              key={target}
              value={target}
              lang={target}
              onSelect={async () => {
                await setLocale({ locale: LOCALE_CODE[target] });
                router.replace({ pathname, query }, { locale: target });
              }}
            >
              {t(LABEL_KEY[target])}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
