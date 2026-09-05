import type { MetadataRoute } from "next";
import { absoluteUrl, localizedAlternates } from "@/i18n/metadata";
import { MARKETING_ROUTES } from "@/i18n/pathnames";
import { LOCALES } from "@/i18n/routing";

/** Every public route in both languages with its language alternates (spec 0004, AC-10). Server, request time. */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return MARKETING_ROUTES.flatMap((route) =>
    LOCALES.map((locale) => ({
      url: absoluteUrl(route, locale),
      lastModified,
      alternates: { languages: localizedAlternates(route, locale).languages },
    })),
  );
}
