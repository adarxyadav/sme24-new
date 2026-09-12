/**
 * The dates the legal pages state (spec 0015, AC-6). Written by hand rather than taken from the
 * build clock: "last updated" must mean the day the text last changed, and a deploy that only
 * fixed a typo elsewhere would otherwise silently claim the policy is newer than it is.
 *
 * Bump the matching constant in the same commit that changes the text. Pure data.
 */

/** The day the privacy policy text last changed, ISO 8601. */
export const PRIVACY_UPDATED = "2026-09-12";

/** The day the terms text last changed, ISO 8601. */
export const TERMS_UPDATED = "2026-09-12";
