"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";
import { createInviteClient, inviteStaffUser, resendStaffInvite } from "@/lib/auth/invite";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { parseWith } from "@/lib/validation";
import { expertIdSchema, inviteExpertSchema } from "./schema";

/**
 * The expert actions (spec 0012). Every one authorises the caller here, not only in the proxy: the
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
  if (!expert || expert.status !== "invited") return { ok: false, error: "not_invited" };

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
