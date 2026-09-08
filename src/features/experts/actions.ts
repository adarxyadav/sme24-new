"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";
import { captureServerEvent } from "@/lib/analytics/server";
import { createInviteClient, inviteStaffUser, resendStaffInvite } from "@/lib/auth/invite";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { parseWith } from "@/lib/validation";
import {
  assignExpertSchema,
  endAssignmentSchema,
  expertIdSchema,
  inviteExpertSchema,
  onboardingSchema,
} from "./schema";

/**
 * The expert actions (spec 0013). Every one authorises the caller here, not only in the proxy: the
 * area gate never runs for a server action post, so an action that trusted it would be reachable by
 * anyone with a session. Each answers a typed result and never throws for an expected failure.
 */

export type InviteExpertResult =
  | { ok: true; data: { expertId: string } }
  | {
      ok: false;
      error:
        | "validation"
        | "email_taken"
        | "already_invited"
        | "invite_failed"
        | "forbidden"
        | "unexpected";
    };

/** The ops caller plus a service client, for the writes that sit outside every app role's grants. */
async function requireOps() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops" || typeof claims?.sub !== "string") return null;
  const env = serverEnv();
  return {
    supabase,
    userId: claims.sub,
    service: createInviteClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY),
    appUrl: env.NEXT_PUBLIC_APP_URL,
  };
}

/**
 * Invites an expert by email with the role fixed (AC-2). The steps and their rollbacks live in
 * `inviteStaffUser`, shared with `pnpm user:invite`, so the admin page and the script create the
 * same rows in the same order. Server action, ops only.
 */
export async function inviteExpert(
  _previous: InviteExpertResult | null,
  input: unknown,
): Promise<InviteExpertResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(inviteExpertSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { email, fullName, locale: inviteeLocale } = parsed.data;

  const result = await inviteStaffUser(actor.service, {
    email,
    // The role is a literal here and nowhere else: it never comes from the form.
    role: "expert",
    locale: inviteeLocale,
    fullName,
    invitedBy: actor.userId,
    appUrl: actor.appUrl,
  });

  if (!result.ok) {
    if (result.error === "email_taken" || result.error === "already_invited") {
      log.info("expert invite refused", { email, reason: result.error });
      return { ok: false, error: result.error };
    }
    log.error("expert invite failed", { email, reason: result.message });
    Sentry.captureException(new Error(`expert invite failed: ${result.message}`), {
      tags: { source: "experts" },
    });
    return { ok: false, error: "invite_failed" };
  }

  const expertId = result.expertId ?? result.userId;
  log.info("expert invited", { expertId, invitedBy: actor.userId, locale: inviteeLocale });
  revalidatePath("/admin/experts");
  return { ok: true, data: { expertId } };
}

export type ResendInviteResult =
  | { ok: true; data: { expertId: string; invitedAt: string } }
  | {
      ok: false;
      error:
        | "validation"
        | "not_invited"
        | "rate_limited"
        | "invite_failed"
        | "forbidden"
        | "unexpected";
    };

/**
 * Sends the invite email again to an expert who has not signed in yet (AC-3), and refreshes
 * `invited_at` so the ops list shows when it last went out. Server action, ops only.
 */
export async function resendInvite(
  _previous: ResendInviteResult | null,
  input: unknown,
): Promise<ResendInviteResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(expertIdSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { expertId } = parsed.data;

  const { data: expert, error } = await actor.service
    .from("expert_profiles")
    .select("email, status, profiles!expert_profiles_expert_id_fkey(locale)")
    .eq("expert_id", expertId)
    .maybeSingle();
  if (error) return reportFailure("expert resend lookup failed", error.message, "unexpected");
  // Only an expert who has never signed in can be resent to: confirming moves the status on, and
  // Supabase would answer email_exists for a confirmed user.
  if (expert?.status !== "invited") return { ok: false, error: "not_invited" };

  const inviteeLocale = (expert.profiles as { locale: string } | null)?.locale;
  const sent = await resendStaffInvite(actor.service, {
    email: expert.email,
    locale: inviteeLocale === "de" ? "de" : "en",
    appUrl: actor.appUrl,
  });
  if (!sent.ok) {
    if (sent.error === "rate_limited") {
      log.info("expert invite resend rate limited", { expertId });
      return { ok: false, error: "rate_limited" };
    }
    return reportFailure("expert invite resend failed", sent.message, "invite_failed");
  }

  const invitedAt = new Date().toISOString();
  const { error: stampError } = await actor.service
    .from("expert_profiles")
    .update({ invited_at: invitedAt })
    .eq("expert_id", expertId);
  // The email is already out, so a failed stamp is a stale timestamp on a list, not a failure to
  // report to ops: saying "the invite failed" here would be untrue and would invite a second send.
  if (stampError)
    log.warn("expert invited_at not refreshed", { expertId, reason: stampError.message });

  log.info("expert invite resent", { expertId, by: actor.userId });
  revalidatePath("/admin/experts");
  return { ok: true, data: { expertId, invitedAt } };
}

/** Logs, reports and maps an unexpected failure onto the action's own error union. Server only. */
function reportFailure<E extends string>(
  what: string,
  reason: string,
  error: E,
): { ok: false; error: E } {
  log.error(what, { reason });
  Sentry.captureException(new Error(`${what}: ${reason}`), { tags: { source: "experts" } });
  return { ok: false, error };
}

export type OnboardingResult =
  | { ok: true; data: { expertId: string } }
  | { ok: false; error: "validation" | "forbidden" | "unexpected" };

/** A signed in expert with their own profile row, whatever its status; the action decides on that. */
async function requireExpert() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "expert" || typeof claims?.sub !== "string") return null;
  return { supabase, userId: claims.sub };
}

/**
 * Records the expert's consent and the few fields that make them assignable, then moves the row to
 * `active` (AC-4). The order matters: consent, then the name, then the profile fields, then the
 * status, because the status is what opens the rest of the area and nothing should open before the
 * row behind it is complete.
 *
 * Idempotent by construction, so a double submit is harmless: `accept_terms()` writes only while
 * the stamp is null and `set_expert_status` treats `active → active` as a no op that returns the
 * row. Server action, the expert on their own row.
 */
export async function completeExpertOnboarding(
  _previous: OnboardingResult | null,
  input: unknown,
): Promise<OnboardingResult> {
  const locale = resolveLocale(
    (input as { locale?: unknown } | null)?.locale ?? (await getLocale()),
  );
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(onboardingSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { fullName, headline, languages, regions } = parsed.data;

  // The gate never runs for an action post, so the status is re checked here: an inactive expert
  // must not be able to onboard their way back in.
  const { data: profile, error: profileError } = await actor.supabase
    .from("expert_profiles")
    .select("status")
    .eq("expert_id", actor.userId)
    .maybeSingle();
  if (profileError)
    return reportFailure("expert onboarding lookup failed", profileError.message, "unexpected");
  if (profile?.status !== "invited" && profile?.status !== "active")
    return { ok: false, error: "forbidden" };

  const { error: consentError } = await actor.supabase.rpc("accept_terms");
  if (consentError)
    return reportFailure("expert consent failed", consentError.message, "unexpected");

  const { error: nameError } = await actor.supabase
    .from("profiles")
    .update({ full_name: fullName })
    .eq("id", actor.userId);
  if (nameError) return reportFailure("expert name update failed", nameError.message, "unexpected");

  const { error: fieldsError } = await actor.supabase
    .from("expert_profiles")
    .update({ headline, languages: [...languages], regions: [...regions] })
    .eq("expert_id", actor.userId);
  if (fieldsError)
    return reportFailure("expert profile update failed", fieldsError.message, "unexpected");

  const { error: statusError } = await actor.supabase.rpc("set_expert_status", {
    target: actor.userId,
    next: "active",
  });
  if (statusError)
    return reportFailure("expert activation failed", statusError.message, "unexpected");

  await captureServerEvent({ distinctId: actor.userId, event: "expert_onboarded" });
  log.info("expert onboarded", { expertId: actor.userId });
  revalidatePath("/expert");
  return { ok: true, data: { expertId: actor.userId } };
}

export type AssignExpertResult =
  | { ok: true; data: { assignmentId: string } }
  | {
      ok: false;
      error:
        | "validation"
        | "expert_not_active"
        | "already_assigned"
        | "not_found"
        | "forbidden"
        | "unexpected";
    };

/** Postgres codes the assign insert can answer with, each a case ops can act on. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const CHECK_VIOLATION = "23514";

/**
 * Assigns an expert to a client organization (AC-9). Eligibility is not checked here: the
 * `check_expert_assignable` trigger raises `expert_not_active` inside the insert, so a
 * deactivation racing this call cannot leave an assignment on an expert who has just left.
 * Server action, ops only.
 */
export async function assignExpert(
  _previous: AssignExpertResult | null,
  input: unknown,
): Promise<AssignExpertResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(assignExpertSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { expertId, organizationId } = parsed.data;

  const { data, error } = await actor.supabase
    .from("expert_assignments")
    .insert({
      expert_id: expertId,
      organization_id: organizationId,
      status: "active",
      assigned_by: actor.userId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, error: "already_assigned" };
    if (error.code === FOREIGN_KEY_VIOLATION) return { ok: false, error: "not_found" };
    // The trigger's own errcode; its message names the expert and the status it found.
    if (error.code === CHECK_VIOLATION && error.message.includes("expert_not_active"))
      return { ok: false, error: "expert_not_active" };
    return reportFailure("expert assign failed", error.message, "unexpected");
  }

  await captureServerEvent({
    distinctId: expertId,
    event: "expert_assigned",
    properties: { organization_id: organizationId },
  });
  log.info("expert assigned", { expertId, organizationId, by: actor.userId });
  revalidatePath("/admin/experts");
  return { ok: true, data: { assignmentId: data.id } };
}

export type EndAssignmentResult =
  | { ok: true; data: { assignmentId: string; endedAt: string } }
  | { ok: false; error: "validation" | "not_found" | "forbidden" | "unexpected" };

/**
 * Ends one assignment (AC-9), which closes the expert's read access to that organization and
 * removes them from the client's card. `ended_at` is stamped by the transition trigger, not here.
 * The update names only active rows, so ending an already ended assignment answers `not_found`
 * rather than raising in the trigger. Server action, ops only.
 */
export async function endAssignment(
  _previous: EndAssignmentResult | null,
  input: unknown,
): Promise<EndAssignmentResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(endAssignmentSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { assignmentId } = parsed.data;

  const { data, error } = await actor.supabase
    .from("expert_assignments")
    .update({ status: "ended" })
    .eq("id", assignmentId)
    .eq("status", "active")
    .select("id, ended_at")
    .maybeSingle();
  if (error) return reportFailure("expert assignment end failed", error.message, "unexpected");
  if (!data) return { ok: false, error: "not_found" };

  log.info("expert assignment ended", { assignmentId, by: actor.userId });
  revalidatePath("/admin/experts");
  return { ok: true, data: { assignmentId: data.id, endedAt: data.ended_at ?? "" } };
}
