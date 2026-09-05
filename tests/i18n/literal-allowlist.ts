/**
 * The only exception to "every user facing string comes from the catalogs" (spec 0004, AC-5).
 * Reviewed like code: add a literal here only when it is not language (a brand name, a unit, a
 * code sample, an identifier shown as is), never to skip a translation.
 */

/** Files the scan skips entirely, relative to the repository root. */
export const ALLOWED_FILES: readonly string[] = [];

/** Exact literals (trimmed) allowed anywhere. */
export const ALLOWED_LITERALS: readonly string[] = [
  "SME24",
  "sme24.ch",
  "EHS",
  "CHF",
  "Geist",
  "Geist Mono",
  "Aa", // the type sample glyph in the tokens gallery
  "run_01j9k3x7z2 · CHF-2026-0042", // identifier samples in the type gallery
];

/** Patterns for families of allowed literals: identifiers, code samples, units. */
export const ALLOWED_PATTERNS: readonly RegExp[] = [
  /^className=/, // code samples that show a prop
  /^(·\s*)?--[a-z-]*$/, // CSS custom property names shown in the gallery
  /^(text|bg|border|font|tracking|rounded|size|shadow|ring)-[a-z0-9-]+$/, // Tailwind utility names shown as is
  /^[A-Z]{2}$/, // canton codes
  /^\d+(\.\d+)?\s?(px|rem|em|%|ms|s)$/, // measurements
];
