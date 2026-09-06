// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import robots from "../src/app/robots";

/**
 * `robots.txt` (spec 0004, AC-10; spec 0009, AC-4): only a production deployment invites
 * indexing. A preview, staging or local copy answers `disallow: /` with no sitemap line, so a
 * self canonical copy of the site is never indexed; production keeps the signed in areas and
 * the API out and points at the sitemap under the public host.
 */
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

describe("robots (AC-4)", () => {
  it("disallows everything and names no sitemap outside production", () => {
    vi.stubEnv("VERCEL_ENV", "");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(robots()).toEqual({ rules: [{ userAgent: "*", disallow: "/" }] });
  });

  it("allows the site, keeps the signed in areas and the API out and lists the sitemap in production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(robots()).toEqual({
      rules: [
        { userAgent: "*", allow: "/", disallow: ["/*/app", "/*/expert", "/*/admin", "/api"] },
      ],
      sitemap: "https://sme24.ch/sitemap.xml",
    });
  });
});
