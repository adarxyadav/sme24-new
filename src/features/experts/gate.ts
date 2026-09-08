import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";
import { localizedPath } from "@/lib/auth/redirects";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The expert area gate (spec 0013, AC-4). Read with the caller's own client on every page render:
 * an expert may only reach the area once they have consented and their profile is `active`, and an
 * expert whose account has been ended is sent away even while their access token is still alive
 * (the ban only bites at the next refresh, up to an hour later).
 *
 * This is a page render concern only. It never runs for a server action post, which is why every
 * action in `actions.ts` re checks the caller's status for itself rather than trusting the gate.
 * Server component, called from the two expert layouts.
 */

export type ExpertGateState = "onboarding" | "ready" | "inactive" | "unknown";

/**
 * What the caller's row says about where they belong: `onboarding` while the consent is missing or
 * the row is still `invited`, `inactive` when the account has been ended, `unknown` when there is
 * no row at all (an ops user reaching the area, or a profile that was never created). Throws only
 * on a real database error; a hidden row reads as `unknown`. Server component.
 */
export async function readExpertGate(): Promise<ExpertGateState> {
  const supabase = await createServerSupabaseClient();
  const [{ data: profileData }, { data: expertData }] = await Promise.all([
    supabase.from("profiles").select("terms_accepted_at").maybeSingle(),
    supabase.from("expert_profiles").select("status").maybeSingle(),
  ]);

  if (!expertData) return "unknown";
  if (expertData.status === "inactive") return "inactive";
  if (expertData.status === "invited" || !profileData?.terms_accepted_at) return "onboarding";
  return "ready";
}

/**
 * The gate for every expert page but the onboarding one: sends an unfinished expert to onboarding
 * and an ended one to `/forbidden`. An expert without a row is left alone, so a missing profile
 * shows the area's own empty state rather than an onboarding loop. Server component.
 */
export async function requireOnboardedExpert(): Promise<void> {
  const state = await readExpertGate();
  if (state !== "inactive" && state !== "onboarding") return;
  const locale = resolveLocale(await getLocale());
  redirect(localizedPath(locale, state === "inactive" ? "/forbidden" : "/expert/onboarding"));
}

/**
 * The gate for the onboarding page itself: an expert who has already finished is sent to the area,
 * so the page is never a second consent screen, and an ended one is sent away like anywhere else.
 * Server component.
 */
export async function requireOnboardingExpert(): Promise<void> {
  const state = await readExpertGate();
  if (state === "onboarding") return;
  const locale = resolveLocale(await getLocale());
  redirect(localizedPath(locale, state === "inactive" ? "/forbidden" : "/expert"));
}
