import { getPathname } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";

/**
 * The localized checkout path for one package (spec 0011, AC-16), used as the `next` a pricing
 * page button carries through sign up so the visitor lands back on the checkout for the package
 * they picked. Built with `getPathname`, so the German slug is used in German.
 *
 * It is a plain path inside the locale, which is exactly what `nextWithinLocale` validates before
 * anything redirects to it. Pure.
 */
export function checkoutPath(locale: Locale, packageKey: string): string {
  return `${getPathname({ locale, href: "/app/checkout" })}?package=${encodeURIComponent(packageKey)}`;
}
