"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const labelKey = { de: "german", en: "english" } as const;

/** Explicit language switch; next-intl writes the locale cookie on the change (spec 0001). */
export function LocaleSwitcher() {
  const t = useTranslations("common");
  const locale = useLocale();
  const pathname = usePathname();

  return (
    <nav aria-label={t("language")} className="flex items-center gap-2 text-sm">
      {routing.locales.map((target) => {
        const active = target === locale;
        return (
          <Link
            key={target}
            href={pathname}
            locale={target}
            hrefLang={target}
            aria-current={active ? "true" : undefined}
            className={
              active
                ? "rounded-md bg-foreground px-2 py-1 font-medium text-background"
                : "rounded-md px-2 py-1 text-muted-foreground underline-offset-4 hover:underline"
            }
          >
            {t(labelKey[target])}
          </Link>
        );
      })}
    </nav>
  );
}
