import { describe, expect, it } from "vitest";
import { MARKETING_ROUTES, PATHNAMES } from "@/i18n/pathnames";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_CODE,
  LOCALES,
  localeFromCode,
  resolveLocale,
  routing,
} from "@/i18n/routing";

/**
 * The locale table (spec 0004, AC-1): region aware locales behind short URL prefixes, one table
 * mapping each locale to the short code the database stores, and the prefixes derived from it.
 */
describe("locales and short codes (spec 0004, AC-1)", () => {
  it("offers exactly de-CH and en-CH with English as the default", () => {
    expect([...LOCALES]).toEqual(["de-CH", "en-CH"]);
    expect(DEFAULT_LOCALE).toBe("en-CH");
    expect(routing.defaultLocale).toBe("en-CH");
    expect([...routing.locales]).toEqual([...LOCALES]);
  });

  it("maps each locale to its short language code", () => {
    expect(LOCALE_CODE).toEqual({ "de-CH": "de", "en-CH": "en" });
  });

  it("derives every URL prefix from the same table, so prefix and short code are one string", () => {
    const localePrefix = routing.localePrefix;
    // next-intl types the option as a string or one of three objects; the app passes `always` with prefixes.
    if (typeof localePrefix !== "object" || localePrefix.mode !== "always") {
      throw new Error("expected localePrefix in the `always` object form");
    }
    for (const locale of LOCALES) {
      expect(localePrefix.prefixes?.[locale]).toBe(`/${LOCALE_CODE[locale]}`);
    }
  });

  it("turns a stored short code or URL prefix back into the locale", () => {
    expect(localeFromCode("de")).toBe("de-CH");
    expect(localeFromCode("en")).toBe("en-CH");
  });

  it("gives the default locale for an unknown, empty or missing code", () => {
    expect(localeFromCode("fr")).toBe("en-CH");
    expect(localeFromCode("de-CH")).toBe("en-CH");
    expect(localeFromCode("en-CH")).toBe("en-CH");
    expect(localeFromCode("")).toBe("en-CH");
    expect(localeFromCode(null)).toBe("en-CH");
    expect(localeFromCode(undefined)).toBe("en-CH");
  });

  it("round trips every locale through its short code", () => {
    for (const locale of LOCALES) {
      expect(localeFromCode(LOCALE_CODE[locale])).toBe(locale);
    }
  });

  it("recognises only the full locale tags, never the short codes", () => {
    expect(isLocale("de-CH")).toBe(true);
    expect(isLocale("en-CH")).toBe(true);
    expect(isLocale("de")).toBe(false);
    expect(isLocale("en")).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale(42)).toBe(false);
    expect(resolveLocale("en-CH")).toBe("en-CH");
    expect(resolveLocale("en")).toBe("en-CH");
  });

  it("switches languages only through an explicit choice: no detection, one cookie, no middleware alternates", () => {
    expect(routing.localeDetection).toBe(false);
    expect(routing.localeCookie).toMatchObject({ name: "NEXT_LOCALE" });
    expect(routing.alternateLinks).toBe(false);
  });
});

describe("typed route map (spec 0004, AC-13)", () => {
  it("lists every existing route so Link, redirect and getPathname are typed", () => {
    expect(Object.keys(PATHNAMES)).toEqual(
      expect.arrayContaining([
        "/",
        "/sign-in",
        "/sign-up",
        "/verify-code",
        "/forgot-password",
        "/reset-password",
        "/forbidden",
        "/app",
        "/app/onboarding",
        "/expert",
        "/admin",
        "/admin/design",
      ]),
    );
    expect(routing.pathnames).toBe(PATHNAMES);
  });

  it("keeps the signed in areas, the auth pages and forbidden identical in both languages", () => {
    for (const route of [
      "/sign-in",
      "/sign-up",
      "/verify-code",
      "/forgot-password",
      "/reset-password",
      "/forbidden",
      "/app",
      "/app/onboarding",
      "/expert",
      "/admin",
      "/admin/design",
    ] as const) {
      expect(PATHNAMES[route]).toBe(route);
    }
  });

  it("only iterates marketing routes that exist in the map", () => {
    expect(MARKETING_ROUTES).toContain("/");
    for (const route of MARKETING_ROUTES) {
      expect(PATHNAMES).toHaveProperty(route);
    }
  });
});
