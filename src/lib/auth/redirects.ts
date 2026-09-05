import { getPathname } from "@/i18n/navigation";
import type { StaticPathname } from "@/i18n/pathnames";
import { LOCALE_CODE, type Locale, localeFromCode } from "@/i18n/routing";
import { type AppRole, ROLE_HOME } from "./roles";

/**
 * Where a sign in lands (spec 0005). Pure helpers shared by the proxy, the auth actions and the
 * `/api/auth` route handlers, so the one rule ("`next` only inside the current locale prefix,
 * else the role home") lives in one place.
 */

/** The URL prefix of a locale (`/de`). Pure. */
export function localePrefix(locale: Locale): string {
  return `/${LOCALE_CODE[locale]}`;
}

/**
 * The locale a prefixed path belongs to (`/en/app` → `en-CH`), or null when the first segment is
 * not a known prefix. Pure.
 */
export function localeOfPath(path: string): Locale | null {
  const code = path.split("/")[1] ?? "";
  const locale = localeFromCode(code);
  return LOCALE_CODE[locale] === code ? locale : null;
}

/**
 * `next` when it is a path inside the given locale prefix (`/de/app/companies` for `de-CH`), else
 * null. Only a path with the prefix and a further segment is accepted: no protocol, no host, no
 * other locale. Pure.
 */
export function nextWithinLocale(next: unknown, locale: Locale): string | null {
  if (typeof next !== "string") return null;
  const prefix = localePrefix(locale);
  if (!next.startsWith(`${prefix}/`)) return null;
  if (next.startsWith("//") || next.includes("\\")) return null;
  return next;
}

/** The localized path of a static route (`/de/sign-in`). Pure. */
export function localizedPath(locale: Locale, href: StaticPathname): string {
  return getPathname({ locale, href });
}

/** The home of a role in the given locale (`/en/admin`); the marketing home when there is no role. Pure. */
export function roleHomePath(role: AppRole | null, locale: Locale): string {
  return localizedPath(locale, role ? ROLE_HOME[role] : "/");
}

/** `next` when valid for the locale, else the role home (spec 0005, value sourcing "every redirect"). Pure. */
export function landingPath(next: unknown, role: AppRole | null, locale: Locale): string {
  return nextWithinLocale(next, locale) ?? roleHomePath(role, locale);
}
