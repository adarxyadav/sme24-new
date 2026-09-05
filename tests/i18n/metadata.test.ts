import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localizedAlternates } from "@/i18n/metadata";
import { MARKETING_ROUTES } from "@/i18n/pathnames";
import { resetEnvCache } from "@/lib/env";
import sitemap from "../../src/app/sitemap";

describe("language alternates and sitemap (spec 0004, AC-10)", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://sme24.ch");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    resetEnvCache();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("returns the canonical URL of the current locale plus both languages and x-default in English", () => {
    expect(localizedAlternates("/", "en-CH")).toEqual({
      canonical: "https://sme24.ch/en",
      languages: {
        "de-CH": "https://sme24.ch/de",
        "en-CH": "https://sme24.ch/en",
        "x-default": "https://sme24.ch/en",
      },
    });
    expect(localizedAlternates("/sign-in", "de-CH").canonical).toBe("https://sme24.ch/de/sign-in");
  });

  it("lists every marketing route in both locales with the same alternates", () => {
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual(
      MARKETING_ROUTES.flatMap((route) => [
        `https://sme24.ch/de${route === "/" ? "" : route}`,
        `https://sme24.ch/en${route === "/" ? "" : route}`,
      ]),
    );
    for (const entry of entries) {
      expect(entry.alternates?.languages).toEqual(localizedAlternates("/", "de-CH").languages);
    }
  });
});
