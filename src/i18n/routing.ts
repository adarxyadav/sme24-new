import { defineRouting } from "next-intl/routing";

// Spec 0001: locale prefix always, default German, no browser language detection,
// an explicit switcher writes the locale cookie.
export const routing = defineRouting({
  locales: ["de", "en"],
  defaultLocale: "de",
  localePrefix: "always",
  localeDetection: false,
  localeCookie: { name: "NEXT_LOCALE" },
});

export type Locale = (typeof routing.locales)[number];
