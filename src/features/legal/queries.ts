import { createServerSupabaseClient } from "@/lib/supabase/server";
import { termsAreCurrent } from "./terms";

/**
 * The legal reads (spec 0015). The terms gate is the only one so far: the shell asks, on every
 * signed in render, whether the caller still stands on the current terms.
 */

/**
 * Whether the caller must re accept the terms before using a signed in page (AC-10).
 *
 * Read with the caller's own client under RLS, which limits the row to their own profile. A caller
 * with no readable profile row is treated as current: they are either signed out, in which case
 * the proxy has already turned them away, or mid sign up, and a blocking dialog over an empty
 * shell would strand them with nothing to accept against. A caller who has never accepted anything
 * is treated the same way, and for the same reason: their consent is owed to the onboarding flow
 * that is already asking for it, not to a dialog blocking the page they are trying to reach.
 *
 * A database error is treated the same way, deliberately. This gate decides whether to obstruct
 * every signed in page, so a transient read failure must fail open; the write path is what carries
 * the compliance guarantee, and `accept_terms()` is the only thing that can satisfy it. Server
 * component, called from the shared area shell.
 */
export async function readTermsStale(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("terms_version, terms_accepted_at")
    .maybeSingle();
  if (error || !data) return false;
  // Both columns, because the version alone lies. `terms_version` carries a `not null default '1'`,
  // so a profile that never accepted anything — a staff account created by the invite path, before
  // onboarding records consent — still reads as version 1. Only an acceptance makes a version mean
  // something, which is the invariant the two columns are supposed to keep.
  if (!data.terms_accepted_at) return false;
  return !termsAreCurrent(data.terms_version);
}
