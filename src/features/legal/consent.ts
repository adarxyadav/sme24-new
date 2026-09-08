/**
 * The consent choice (spec 0015, AC-3): the cookie name, the version stamped into its value and
 * the pure functions that read and parse it. No zod and no server import, because the cookie bar
 * and the analytics gate are browser modules (the Biome override keeps `@/lib/env` out of them).
 * Pure data and pure functions; runs anywhere.
 */

/** The first party cookie holding the choice. Replaces spec 0001's `analytics_consent` stub. */
export const CONSENT_COOKIE = "sme24_consent";

/**
 * The version stamped into the cookie value. Bumping it makes every stored answer stale, so the
 * bar opens again: that is the only way to ask a past visitor about a new purpose.
 */
export const CONSENT_VERSION = "1";

/** One year, the cookie's lifetime, in seconds. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** What a visitor may answer. `denied` is a real answer, not the absence of one. */
export const CONSENT_CHOICES = ["granted", "denied"] as const;

/** The visitor's answer to the cookie bar. */
export type ConsentChoice = (typeof CONSENT_CHOICES)[number];

/** A parsed answer, or `null` when there is none for the current version. */
export type Consent = { readonly choice: ConsentChoice; readonly version: string } | null;

/** Whether `value` is one of the two answers. Pure; the type guard both the action and the parser use. */
export function isConsentChoice(value: unknown): value is ConsentChoice {
  return typeof value === "string" && CONSENT_CHOICES.includes(value as ConsentChoice);
}

/**
 * The separator between the choice and the version. A dot rather than a colon because a colon is
 * a reserved character that Next's cookie serialiser percent encodes, which would leave
 * `granted%3A1` in the jar and make the stored value harder to read than it needs to be.
 */
const SEPARATOR = ".";

/** The cookie value for a choice: `granted.1` or `denied.1`. Pure. */
export function consentCookieValue(choice: ConsentChoice): string {
  return `${choice}${SEPARATOR}${CONSENT_VERSION}`;
}

/**
 * Parses a stored cookie value into a current answer (AC-3). A value whose version segment is not
 * `CONSENT_VERSION` returns `null` — an old answer counts as no answer, granted or denied alike,
 * which is the entire reason the version is in the value. Pure.
 */
export function parseConsent(value: string | undefined | null): Consent {
  if (!value) return null;
  const separator = value.indexOf(SEPARATOR);
  if (separator < 0) return null;
  const choice = value.slice(0, separator);
  const version = value.slice(separator + 1);
  if (!isConsentChoice(choice) || version !== CONSENT_VERSION) return null;
  return { choice, version };
}

/**
 * Reads the current answer out of a `document.cookie` string (AC-3). Takes the string rather than
 * touching `document`, so it is testable in Vitest without a DOM. Pure.
 */
export function readConsent(cookieHeader: string | undefined | null): Consent {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmedPart = part.trim();
    if (trimmedPart.startsWith(`${CONSENT_COOKIE}=`)) {
      return parseConsent(decodeURIComponent(trimmedPart.slice(CONSENT_COOKIE.length + 1)));
    }
  }
  return null;
}

/** Whether analytics may load: an answer exists, it is current, and it is `granted`. Pure. */
export function analyticsAllowed(consent: Consent): boolean {
  return consent?.choice === "granted";
}
