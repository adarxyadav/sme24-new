import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { clientEnv } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = clientEnv().NEXT_PUBLIC_APP_URL;
  const languages = Object.fromEntries(routing.locales.map((l) => [l, `${base}/${l}`]));

  return routing.locales.map((locale) => ({
    url: `${base}/${locale}`,
    lastModified: new Date(),
    alternates: { languages },
  }));
}
