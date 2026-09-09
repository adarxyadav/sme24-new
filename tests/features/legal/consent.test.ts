import { describe, expect, it } from "vitest";
import {
  analyticsAllowed,
  CONSENT_COOKIE,
  CONSENT_VERSION,
  consentCookieValue,
  isConsentChoice,
  parseConsent,
  readConsent,
} from "@/features/legal/consent";

/** The pure consent rules (spec 0015, AC-1, AC-3, AC-4). */
describe("consent", () => {
  it("ships at version 1 so nobody is retroactively stale", () => {
    // Shipping a higher version would reopen the bar for every visitor on the day this deploys.
    expect(CONSENT_VERSION).toBe("1");
  });

  it("stamps the current version into the cookie value", () => {
    expect(consentCookieValue("granted")).toBe(`granted.${CONSENT_VERSION}`);
    expect(consentCookieValue("denied")).toBe(`denied.${CONSENT_VERSION}`);
  });

  it("accepts only the two answers", () => {
    expect(isConsentChoice("granted")).toBe(true);
    expect(isConsentChoice("denied")).toBe(true);
    for (const value of ["", "yes", "GRANTED", null, undefined, 1, {}]) {
      expect(isConsentChoice(value)).toBe(false);
    }
  });

  describe("parseConsent", () => {
    it("reads a current answer of either kind", () => {
      expect(parseConsent(`granted.${CONSENT_VERSION}`)).toEqual({
        choice: "granted",
        version: CONSENT_VERSION,
      });
      expect(parseConsent(`denied.${CONSENT_VERSION}`)).toEqual({
        choice: "denied",
        version: CONSENT_VERSION,
      });
    });

    it("treats an answer stamped with another version as no answer, granted or denied alike (AC-3)", () => {
      expect(parseConsent("granted.0")).toBeNull();
      expect(parseConsent("denied.0")).toBeNull();
      expect(parseConsent(`granted.${CONSENT_VERSION}9`)).toBeNull();
    });

    it("compares the version by equality, so no version orders as older than another", () => {
      // The segment is text, exactly like `profiles.terms_version`: a numeric `<` would read
      // '10' as older than '2'. Only equality decides, so a stamp of '10' against a current '1'
      // is simply not current.
      expect(parseConsent("granted.10")).toBeNull();
    });

    it("returns no answer for an absent, empty or malformed value", () => {
      for (const value of [undefined, null, "", "granted", ".1", "granted.", "x.y"]) {
        expect(parseConsent(value)).toBeNull();
      }
    });
  });

  describe("readConsent", () => {
    it("finds the cookie among others and ignores a lookalike name", () => {
      const header = `theme=dark; ${CONSENT_COOKIE}=granted.${CONSENT_VERSION}; sb-token=abc`;
      expect(readConsent(header)).toEqual({ choice: "granted", version: CONSENT_VERSION });
      expect(readConsent(`other_${CONSENT_COOKIE}=granted.${CONSENT_VERSION}`)).toBeNull();
    });

    it("decodes a percent encoded value", () => {
      expect(readConsent(`${CONSENT_COOKIE}=granted%2E${CONSENT_VERSION}`)).toEqual({
        choice: "granted",
        version: CONSENT_VERSION,
      });
    });

    it("returns no answer for an empty or absent cookie header", () => {
      expect(readConsent("")).toBeNull();
      expect(readConsent(undefined)).toBeNull();
      expect(readConsent("theme=dark")).toBeNull();
    });
  });

  describe("analyticsAllowed", () => {
    it("allows analytics only on a current granted answer (AC-1)", () => {
      expect(analyticsAllowed({ choice: "granted", version: CONSENT_VERSION })).toBe(true);
      expect(analyticsAllowed({ choice: "denied", version: CONSENT_VERSION })).toBe(false);
      expect(analyticsAllowed(null)).toBe(false);
    });

    it("refuses analytics for an outdated stamp, because parsing already dropped it (AC-3)", () => {
      expect(analyticsAllowed(parseConsent("granted.0"))).toBe(false);
    });
  });
});
