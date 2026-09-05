"use server";

import { sendOpsAlert } from "@/lib/alerts/send";
import { roleFromClaims } from "@/lib/auth/roles";
import { OPS_TEST_EMAIL_EVENT } from "@/lib/email/schema";
import { retryEmail, sendEmail } from "@/lib/email/send";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { retryDeliverySchema } from "./schema";

export type EmailActionResult =
  | { ok: true; data: { runId: string } }
  | {
      ok: false;
      error:
        | "forbidden"
        | "invalid"
        | "not_retryable"
        | "webhook_unset"
        | "trigger_unavailable"
        | "trigger_failed";
    };

/** Authorization lives in the action too, not only in the proxy (spec 0006, AC-10). */
async function requireOps() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops" || typeof claims?.sub !== "string") return null;
  return { supabase, userId: claims.sub };
}

/**
 * Retries a failed delivery (AC-10): the row moves from `failed` to `sending` inside the task;
 * the unique row is the only guard, so no Trigger.dev key. Ops only.
 */
export async function retryDelivery(input: { deliveryId: string }): Promise<EmailActionResult> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = retryDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const { data: row } = await actor.supabase
    .from("email_deliveries")
    .select("status")
    .eq("id", parsed.data.deliveryId)
    .maybeSingle();
  if (row?.status !== "failed") return { ok: false, error: "not_retryable" };

  const result = await retryEmail(parsed.data.deliveryId);
  if (!result.ok) return result;
  log.info("delivery retry requested", { deliveryId: parsed.data.deliveryId, by: actor.userId });
  return { ok: true, data: { runId: result.runId } };
}

/**
 * Sends the welcome template to the signed in ops user (AC-10): literal data, the `ops.test_email`
 * source event (no notification row), a timestamped key so every click sends. Ops only.
 */
export async function sendTestEmail(): Promise<EmailActionResult> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const result = await sendEmail({
    template: "welcome",
    data: { organizationName: "SME24 Test" },
    recipient: { userId: actor.userId },
    sourceEvent: OPS_TEST_EMAIL_EVENT,
    idempotencyKey: `ops-test-email/${actor.userId}/${Date.now()}`,
  });
  return result.ok ? { ok: true, data: { runId: result.runId } } : result;
}

/**
 * Posts an `ops.test` alert (AC-10), or answers `webhook_unset` without triggering when the
 * server has no `OPS_ALERT_WEBHOOK_URL`. The actor is named by their profile name, never their
 * email address. Ops only.
 */
export async function sendTestAlert(): Promise<EmailActionResult> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!serverEnv().OPS_ALERT_WEBHOOK_URL) return { ok: false, error: "webhook_unset" };

  const { data: profile } = await actor.supabase
    .from("profiles")
    .select("full_name")
    .eq("id", actor.userId)
    .maybeSingle();
  const result = await sendOpsAlert({
    kind: "ops.test",
    fields: { triggeredBy: profile?.full_name?.trim() || "an ops user" },
    link: "/admin/emails",
    idempotencyKey: `ops-test/${actor.userId}/${Date.now()}`,
  });
  return result.ok ? { ok: true, data: { runId: result.runId } } : result;
}
