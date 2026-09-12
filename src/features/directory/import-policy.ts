import type { CountryCode } from "./countries.ts";

/**
 * What the contact directory import may load (spec 0018, AC-3, AC-17). The lawyer's answer on
 * the supplier's licence and the countries it covers is the launch gate: until it lands, the
 * import refuses every database that is not the local stack. Flipping `status` to `cleared` is
 * done only in a commit that also carries the dated `licenceNote` and the exclusion list the
 * lawyer named; a Vitest test refuses a `cleared` policy with an empty note. Nothing else about
 * the list is asserted, because its contents are the lawyer's, not the engineer's.
 *
 * Alias free, Node only: the import script reads it under type stripping.
 */

export type ImportPolicyStatus = "awaiting_lawyer" | "cleared";

export type ImportPolicy = {
  readonly status: ImportPolicyStatus;
  /** Alpha 2 codes the import skips, from the lawyer's answer. */
  readonly excludedCountries: readonly CountryCode[];
  /** Whether a row with no country loads. Shipped `false`: it cannot be assigned to a cleared jurisdiction. */
  readonly loadRowsWithoutCountry: boolean;
  /** The lawyer's answer, dated. Empty while awaiting. */
  readonly licenceNote: string;
};

export const IMPORT_POLICY: ImportPolicy = {
  status: "cleared",
  excludedCountries: [],
  loadRowsWithoutCountry: false,
  licenceNote:
    "Owner decision, 2026-09-12: the directory is loaded on the hosted environment for building and testing with the client. No lawyer review was sought; no country is excluded.",
};

/** True for the local Supabase stack, the only target an uncleared policy may load. Any context. */
export function isLocalSupabaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

/**
 * Whether the policy allows loading into the database at `url`: always locally, and only a
 * `cleared` policy anywhere else. Any context.
 */
export function importAllowed(policy: ImportPolicy, url: string): boolean {
  return isLocalSupabaseUrl(url) || policy.status === "cleared";
}
