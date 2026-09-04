"use client";

import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { Link, usePathname } from "@/i18n/navigation";
import { type Locale, routing } from "@/i18n/routing";

const LABEL_KEY = { de: "german", en: "english" } as const;

/**
 * Language submenu for the sidebar user menu: one radio item per locale, each a real link to the
 * same page in the other language (next-intl writes the locale cookie on the change, spec 0001).
 * Runs in the browser inside a `DropdownMenuContent`.
 */
export function LocaleMenuItems() {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const pathname = usePathname();

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
            <DropdownMenuRadioItem key={target} value={target} asChild>
              <Link href={pathname} locale={target} hrefLang={target}>
                {t(LABEL_KEY[target])}
              </Link>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
