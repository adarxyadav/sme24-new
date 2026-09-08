"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { CURRENT_TERMS_VERSION } from "@/features/legal/terms";
import { resolveLocale } from "@/i18n/routing";
import { sendOpsAlert } from "@/lib/alerts/send";
import { captureServerEvent } from "@/lib/analytics/server";
import {
  banStaffUser,
  createInviteClient,
  inviteStaffUser,
  resendStaffInvite,
  unbanStaffUser,
} from "@/lib/auth/invite";
import { roleFromClaims } from "@/lib/auth/roles";
import { EXPERT_ASSIGNED_EVENT, EXPERT_ONBOARDED_EVENT } from "@/lib/email/schema";
import { sendEmail } from "@/lib/email/send";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { parseWith } from "@/lib/validation";
import {
  type CompetencyCode,
  isPhotoMimeType,
  PHOTO_BUCKET,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
} from "./catalogue";
import {
  assignExpertSchema,
  endAssignmentSchema,
  expertIdSchema,
  expertProfileSchema,
  inviteExpertSchema,
  onboardingSchema,
  opsNotesSchema,
  todayInZurich,
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
  // The join is the only source of the invitee's language, so a missing one is a guess rather than
  // a preference: say so in the log, or "why did this invite go out in English" needs a query.
  if (inviteeLocale !== "de" && inviteeLocale !== "en")
    log.info("expert invite locale fell back to en", { expertId, found: inviteeLocale ?? null });
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

  // The version is passed explicitly rather than left to the function's default, so a bump of
  // CURRENT_TERMS_VERSION reaches this path too; the default only exists for backward compatibility.
  const { error: consentError } = await actor.supabase.rpc("accept_terms", {
    version: CURRENT_TERMS_VERSION,
  });
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
  await announceOnboarding(actor.userId, fullName);
  log.info("expert onboarded", { expertId: actor.userId });
  revalidatePath("/expert");
  return { ok: true, data: { expertId: actor.userId } };
}

/**
 * The welcome email to the expert and the `expert.onboarded` alert to ops (AC-14), both keyed per
 * expert so a double submit sends one of each. The row is already `active` by the time this runs,
 * so a failed trigger is logged and never turns a completed onboarding into an error the expert
 * sees: `sendEmail` and `sendOpsAlert` answer a result rather than throwing. The address and the
 * competencies come from the row the expert cannot write, read with the service client because the
 * alert needs the address and the expert's own client never exposes it. Server action.
 */
async function announceOnboarding(expertId: string, fullName: string): Promise<void> {
  await sendEmail({
    template: "expert_welcome",
    data: {},
    recipient: { userId: expertId },
    sourceEvent: EXPERT_ONBOARDED_EVENT,
    idempotencyKey: `expert-welcome/${expertId}`,
  });

  const env = serverEnv();
  const service = createInviteClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const { data: profile, error } = await service
    .from("expert_profiles")
    .select("email, competencies")
    .eq("expert_id", expertId)
    .maybeSingle();
  if (error || !profile) {
    log.warn("expert onboarded alert skipped: profile not read", {
      expertId,
      reason: error?.message ?? "not found",
    });
    return;
  }

  await sendOpsAlert({
    kind: "expert.onboarded",
    fields: {
      expertName: fullName,
      email: profile.email,
      competencies: (profile.competencies as readonly CompetencyCode[]).join(", "),
    },
    link: `/admin/experts/${expertId}`,
    idempotencyKey: `expert-onboarded/${expertId}`,
  });
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
  await announceAssignment(actor.service, {
    assignmentId: data.id,
    expertId,
    organizationId,
  });
  log.info("expert assigned", { expertId, organizationId, by: actor.userId });
  revalidatePath("/admin/experts");
  return { ok: true, data: { assignmentId: data.id } };
}

/**
 * The two assignment emails (AC-9, AC-14): `assignment_received` to the expert, keyed per
 * assignment, and `expert_assigned` to every member of the client organization, keyed per
 * assignment and member. The members are read with the service client, after the ops check above,
 * because `organization_members` is a tenant table the ops role does not read through RLS.
 *
 * An organization with no members is not an error: only the expert's email goes out. Ending an
 * assignment sends nothing. The row is already inserted, so every failure here is logged and never
 * fails the action; both send functions answer a result rather than throwing. Server action.
 */
async function announceAssignment(
  service: ReturnType<typeof createInviteClient>,
  ids: {
    readonly assignmentId: string;
    readonly expertId: string;
    readonly organizationId: string;
  },
): Promise<void> {
  const [{ data: organization }, { data: expert }, { data: members }] = await Promise.all([
    service.from("organizations").select("name").eq("id", ids.organizationId).maybeSingle(),
    service
      .from("expert_profiles")
      .select("headline, profiles!expert_profiles_expert_id_fkey(full_name)")
      .eq("expert_id", ids.expertId)
      .maybeSingle(),
    service
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", ids.organizationId),
  ]);

  if (organization) {
    await sendEmail({
      template: "assignment_received",
      data: { organizationName: organization.name, organizationId: ids.organizationId },
      recipient: { userId: ids.expertId },
      sourceEvent: EXPERT_ASSIGNED_EVENT,
      organizationId: ids.organizationId,
      idempotencyKey: `assignment-received/${ids.assignmentId}`,
    });
  } else {
    log.warn("assignment received email skipped: organization not read", ids);
  }

  const expertName = (expert?.profiles as { full_name: string | null } | null)?.full_name?.trim();
  if (!expertName) {
    log.warn("expert assigned emails skipped: the expert has no name", ids);
    return;
  }
  const headline = expert?.headline?.trim();
  for (const member of members ?? []) {
    await sendEmail({
      template: "expert_assigned",
      data: { expertName, ...(headline ? { headline } : {}) },
      recipient: { userId: member.user_id },
      sourceEvent: EXPERT_ASSIGNED_EVENT,
      organizationId: ids.organizationId,
      idempotencyKey: `expert-assigned/${ids.assignmentId}/${member.user_id}`,
    });
  }
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

export type ExpertProfileResult =
  | { ok: true; data: { expertId: string; updatedAt: string } }
  | { ok: false; error: "validation" | "forbidden" | "unexpected" };

/**
 * Saves the full profile (AC-5), for the expert on their own row and for ops on any row. The
 * column grant is what limits the write to the profile fields: `email`, `status`, `invited_*`,
 * `onboarded_at`, `deactivated_at` and `photo_path` are outside it for both roles, so a caller
 * cannot reach them through this action whatever they send.
 *
 * `expertId` is the only thing that separates the two callers: an expert may not send one, and a
 * caller who does without the ops role is refused rather than quietly writing their own row.
 * Server action, the expert on their own row or ops on any.
 */
export async function updateExpertProfile(
  _previous: ExpertProfileResult | null,
  input: unknown,
): Promise<ExpertProfileResult> {
  const locale = resolveLocale(
    (input as { locale?: unknown } | null)?.locale ?? (await getLocale()),
  );
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const role = roleFromClaims(claims);
  if (typeof claims?.sub !== "string") return { ok: false, error: "forbidden" };
  if (role !== "expert" && role !== "ops") return { ok: false, error: "forbidden" };

  const parsed = parseWith(expertProfileSchema(todayInZurich()), input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { expertId: target, locale: _ignored, ...fields } = parsed.data;

  // Only ops write someone else's row. An expert sending an id is refused outright rather than
  // silently redirected onto their own: a form that sends the wrong id is a bug worth surfacing.
  if (target && role !== "ops") return { ok: false, error: "forbidden" };
  const expertId = target ?? claims.sub;

  const { data: row, error } = await supabase
    .from("expert_profiles")
    .update({
      headline: fields.headline,
      bio: fields.bio,
      competencies: [...fields.competencies],
      industries: [...fields.industries],
      standards: [...fields.standards],
      languages: [...fields.languages],
      regions: [...fields.regions],
      availability: fields.availability,
      available_from: fields.availableFrom,
      availability_note: fields.availabilityNote,
      years_experience: fields.yearsExperience,
      phone: fields.phone,
    })
    .eq("expert_id", expertId)
    .select("expert_id, updated_at")
    .maybeSingle();

  if (error) return reportFailure("expert profile save failed", error.message, "unexpected");
  // RLS hid the row rather than raising: an expert aiming at a row that is not theirs, or ops at
  // an id that does not exist.
  if (!row) return { ok: false, error: "forbidden" };

  log.info("expert profile saved", { expertId, by: claims.sub });
  revalidatePath("/expert/profile");
  revalidatePath("/admin/experts");
  return { ok: true, data: { expertId: row.expert_id, updatedAt: row.updated_at } };
}

export type OpsNotesResult =
  | { ok: true; data: { expertId: string } }
  | { ok: false; error: "validation" | "forbidden" | "unexpected" };

/**
 * Saves the ops record check notes on an expert (AC-8). One row per expert, so this upserts on the
 * primary key; an empty string is a real value, the way ops clear a note. The expert never reads
 * this table: its policies are ops only and a pgTAP file proves it. Server action, ops only.
 */
export async function saveExpertOpsNotes(
  _previous: OpsNotesResult | null,
  input: unknown,
): Promise<OpsNotesResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(opsNotesSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { expertId, notes } = parsed.data;

  const { error } = await actor.supabase
    .from("expert_ops_notes")
    .upsert({ expert_id: expertId, notes, updated_by: actor.userId }, { onConflict: "expert_id" });
  if (error) return reportFailure("expert ops notes save failed", error.message, "unexpected");

  log.info("expert ops notes saved", { expertId, by: actor.userId });
  revalidatePath("/admin/experts");
  return { ok: true, data: { expertId } };
}

export type DeactivateExpertResult =
  | { ok: true; data: { expertId: string; endedAssignments: number } }
  | { ok: false; error: "validation" | "not_found" | "forbidden" | "unexpected" };

/**
 * Offboards an expert (AC-10). The order is what makes it safe: the status moves first, which the
 * `check_expert_assignable` trigger reads, so from that moment no new assignment can land while
 * the sweep below is still running; then the open assignments end; then the sign in is banned.
 *
 * Idempotent on purpose: an already `inactive` expert re runs the sweep and the ban and answers
 * `ok`, so a failure part way through is fixed by pressing the button again rather than by hand.
 * Server action, ops only.
 */
export async function deactivateExpert(
  _previous: DeactivateExpertResult | null,
  input: unknown,
): Promise<DeactivateExpertResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(expertIdSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { expertId } = parsed.data;

  const { error: statusError } = await actor.supabase.rpc("set_expert_status", {
    target: expertId,
    next: "inactive",
  });
  if (statusError) {
    if (statusError.message.includes("not_found")) return { ok: false, error: "not_found" };
    return reportFailure("expert deactivation failed", statusError.message, "unexpected");
  }

  const { data: ended, error: sweepError } = await actor.supabase
    .from("expert_assignments")
    .update({ status: "ended" })
    .eq("expert_id", expertId)
    .eq("status", "active")
    .select("id");
  if (sweepError)
    return reportFailure("expert assignment sweep failed", sweepError.message, "unexpected");

  const banned = await banStaffUser(actor.service, expertId);
  // The status is already `inactive` and the gate already turns the expert away, so a failed ban
  // is a gap that closes on the next press rather than a reason to report the whole action failed.
  if (!banned) log.warn("expert sign in not banned", { expertId });

  log.info("expert deactivated", {
    expertId,
    by: actor.userId,
    endedAssignments: ended?.length ?? 0,
  });
  revalidatePath("/admin/experts");
  return { ok: true, data: { expertId, endedAssignments: ended?.length ?? 0 } };
}

export type ReactivateExpertResult =
  | { ok: true; data: { expertId: string; status: "invited" | "active" } }
  | {
      ok: false;
      error: "validation" | "already_active" | "not_found" | "forbidden" | "unexpected";
    };

/**
 * Brings an expert back (AC-10). The target status comes from `onboarded_at`, not from a guess:
 * an expert who never finished onboarding returns to `invited` and meets the onboarding screen
 * again, one who did returns to `active` and is assignable at once. Server action, ops only.
 */
export async function reactivateExpert(
  _previous: ReactivateExpertResult | null,
  input: unknown,
): Promise<ReactivateExpertResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(expertIdSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { expertId } = parsed.data;

  const { data: profile, error: readError } = await actor.supabase
    .from("expert_profiles")
    .select("status, onboarded_at")
    .eq("expert_id", expertId)
    .maybeSingle();
  if (readError)
    return reportFailure("expert reactivate lookup failed", readError.message, "unexpected");
  if (!profile) return { ok: false, error: "not_found" };
  if (profile.status !== "inactive") return { ok: false, error: "already_active" };

  const next = profile.onboarded_at ? "active" : "invited";
  const { error: statusError } = await actor.supabase.rpc("set_expert_status", {
    target: expertId,
    next,
  });
  if (statusError)
    return reportFailure("expert reactivation failed", statusError.message, "unexpected");

  const lifted = await unbanStaffUser(actor.service, expertId);
  // Unlike the ban, a failed lift leaves the expert unable to sign in while their row says they
  // may, so it is worth a warning ops can act on; pressing the button again retries it.
  if (!lifted) log.warn("expert ban not lifted", { expertId });

  log.info("expert reactivated", { expertId, by: actor.userId, status: next });
  revalidatePath("/admin/experts");
  return { ok: true, data: { expertId, status: next } };
}

export type PhotoResult =
  | { ok: true; data: { photoPath: string | null } }
  | {
      ok: false;
      error: "validation" | "too_large" | "unsupported_type" | "forbidden" | "unexpected";
    };

/**
 * Replaces the calling expert's profile photo (AC-6). The order matters: the object goes up first,
 * then `set_expert_photo` records it, and the previous object is removed only after both have
 * succeeded, so the row never points at an object that is not there.
 *
 * The path is deterministic per extension (`<expert_id>/photo.<ext>`), which is why the cleanup is
 * best effort: an orphan left by a failed delete is overwritten by the next upload of that type,
 * and the bucket policies keep it unreadable by anyone but the expert, ops and their clients.
 * Server action, the expert on their own row.
 */
export async function uploadExpertPhoto(formData: FormData): Promise<PhotoResult> {
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "validation" };
  if (file.size > PHOTO_MAX_BYTES) return { ok: false, error: "too_large" };
  if (!isPhotoMimeType(file.type)) return { ok: false, error: "unsupported_type" };

  const path = `${actor.userId}/photo.${PHOTO_TYPES[file.type]}`;
  const { data: current } = await actor.supabase
    .from("expert_profiles")
    .select("photo_path")
    .eq("expert_id", actor.userId)
    .maybeSingle();

  const { error: uploadError } = await actor.supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError)
    return reportFailure("expert photo upload failed", uploadError.message, "unexpected");

  const { error: pathError } = await actor.supabase.rpc("set_expert_photo", { path });
  if (pathError) {
    // The row was never told about this object, so leaving it would be an unreferenced upload.
    await actor.supabase.storage.from(PHOTO_BUCKET).remove([path]);
    return reportFailure("expert photo path write failed", pathError.message, "unexpected");
  }

  const previous = current?.photo_path;
  if (previous && previous !== path) {
    const { error: cleanupError } = await actor.supabase.storage
      .from(PHOTO_BUCKET)
      .remove([previous]);
    if (cleanupError)
      log.warn("expert photo previous object not removed", {
        expertId: actor.userId,
        reason: cleanupError.message,
      });
  }

  log.info("expert photo uploaded", { expertId: actor.userId });
  revalidatePath("/expert/profile");
  return { ok: true, data: { photoPath: path } };
}

/**
 * Removes the calling expert's photo (AC-6). The row is cleared first, so a failed object delete
 * leaves an unreferenced object rather than a row pointing at nothing; the next upload of the same
 * type overwrites it. Server action, the expert on their own row.
 */
export async function removeExpertPhoto(
  _previous: PhotoResult | null,
  _input: unknown,
): Promise<PhotoResult> {
  const actor = await requireExpert();
  if (!actor) return { ok: false, error: "forbidden" };

  const { data: current } = await actor.supabase
    .from("expert_profiles")
    .select("photo_path")
    .eq("expert_id", actor.userId)
    .maybeSingle();

  // `set_expert_photo` takes a nullable text and clearing the photo is what null means, but the
  // type generator cannot express a nullable function argument, so the cast is the one place the
  // contract in the SQL body outruns the generated signature.
  const { error } = await actor.supabase.rpc("set_expert_photo", {
    path: null as unknown as string,
  });
  if (error) return reportFailure("expert photo clear failed", error.message, "unexpected");

  if (current?.photo_path) {
    const { error: removeError } = await actor.supabase.storage
      .from(PHOTO_BUCKET)
      .remove([current.photo_path]);
    if (removeError)
      log.warn("expert photo object not removed", {
        expertId: actor.userId,
        reason: removeError.message,
      });
  }

  log.info("expert photo removed", { expertId: actor.userId });
  revalidatePath("/expert/profile");
  return { ok: true, data: { photoPath: null } };
}
