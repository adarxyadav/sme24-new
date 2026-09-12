import { createHash } from "node:crypto";

/**
 * The pure text rules the contact directory import and the app share (spec 0018, Value
 * sourcing). Imported by `scripts/directory-import.mts` by relative path and run under Node's
 * type stripping, so this module uses Node built ins only and no `@/` alias.
 */

/** Trims a cell and collapses inner whitespace; an empty result is null. Any context. */
export function cleanCell(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned.length === 0 ? null : cleaned;
}

/**
 * The import key and the search sort key of a company: lower case, trimmed, inner whitespace
 * collapsed. One rule shared by the script, its test and the pgTAP fixtures. Any context.
 */
export function normaliseCompanyName(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

/** The contact import key: the address lower cased and trimmed. Any context. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * The suppression key: SHA 256 hex of the lowercased address, the same expression
 * `directory_remove_contact` evaluates in SQL (`encode(sha256(convert_to(lower(email),
 * 'UTF8')), 'hex')`); a Vitest and a pgTAP case on one invented address keep the two equal.
 * Any context.
 */
export function emailHash(email: string): string {
  return createHash("sha256").update(normaliseEmail(email), "utf8").digest("hex");
}
