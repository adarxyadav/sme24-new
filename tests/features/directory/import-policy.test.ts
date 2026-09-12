// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isCountryCode } from "@/features/directory/countries";
import {
  IMPORT_POLICY,
  importAllowed,
  isLocalSupabaseUrl,
} from "@/features/directory/import-policy";

describe("the import policy (spec 0018, AC-3, AC-17)", () => {
  it("names the lawyer's answer once it is cleared", () => {
    // The gate itself: a `cleared` policy without a dated note is a flip nobody can trace.
    if (IMPORT_POLICY.status === "cleared") {
      expect(IMPORT_POLICY.licenceNote.trim().length).toBeGreaterThan(0);
      expect(IMPORT_POLICY.licenceNote).toMatch(/\d{4}-\d{2}-\d{2}/);
    }
  });

  it("lists only valid alpha 2 codes as excluded", () => {
    for (const code of IMPORT_POLICY.excludedCountries) expect(isCountryCode(code)).toBe(true);
  });

  it("recognises the local stack by host", () => {
    expect(isLocalSupabaseUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalSupabaseUrl("http://localhost:54321")).toBe(true);
    expect(isLocalSupabaseUrl("https://fxmdkvhououxakmyddwn.supabase.co")).toBe(false);
    expect(isLocalSupabaseUrl("not a url")).toBe(false);
  });

  it("allows a local import always and a hosted one only when cleared", () => {
    const awaiting = { ...IMPORT_POLICY, status: "awaiting_lawyer" as const };
    const cleared = { ...IMPORT_POLICY, status: "cleared" as const, licenceNote: "2026-09-30 ok" };
    expect(importAllowed(awaiting, "http://127.0.0.1:54321")).toBe(true);
    expect(importAllowed(awaiting, "https://example.supabase.co")).toBe(false);
    expect(importAllowed(cleared, "https://example.supabase.co")).toBe(true);
  });
});
