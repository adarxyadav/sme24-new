/**
 * The terms version (spec 0015, AC-10): the constant the terms page, the sign up form, the shell
 * gate and the re consent dialog all read, plus the pure comparison between a stored version and
 * the current one. No zod and no server import, because the dialog is a browser module. Pure data
 * and pure functions; runs anywhere.
 */

/**
 * The version of the terms currently in force, matching `profiles.terms_version`'s column default.
 *
 * Version 1 was the acceptance that already happened, given a number for the first time. Version 2
 * (spec 0018, AC-16, 2026-09-12) adds the purchased contacts clause for the expert accounts and
 * deliberately puts the dialog in front of every signed in user once, clients included: spec 0015
 * designed the bump for exactly this, and a separate expert only acceptance would be a second
 * consent machine.
 *
 * Bumping it blocks every signed in user behind the re consent dialog until they accept, so bump
 * it only for a change that genuinely alters the deal, and in the same commit add the matching
 * `legal.terms.changelog.<version>` key to both catalogues (a Vitest test fails until you do) and
 * move `TERMS_UPDATED` in `dates.ts`.
 */
export const CURRENT_TERMS_VERSION = "2";

/**
 * Every version that has ever been in force, oldest first, and the reason the list exists: the
 * changelog test walks it, so a bump that forgets to explain itself fails the suite rather than
 * showing an empty dialog. Append, never rewrite: a past version's entry is a record of what
 * people accepted.
 */
export const TERMS_VERSIONS = ["1", "2"] as const;

/** A version of the terms someone may have accepted. */
export type TermsVersion = (typeof TERMS_VERSIONS)[number];

/**
 * Whether a stored `terms_version` still counts as accepted (AC-10).
 *
 * Equality, never ordering. The column is `text`, so `'10' < '2'` is true and any comparison
 * reading "older than" would treat a tenth version as predating a second one and quietly let a
 * stale profile through. A profile at an unknown version — one from a future deploy, or one this
 * build has never heard of — is stale, which asks again rather than assuming. Pure.
 */
export function termsAreCurrent(storedVersion: string | null | undefined): boolean {
  return storedVersion === CURRENT_TERMS_VERSION;
}
