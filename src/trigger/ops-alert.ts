import "./instrumentation";

import { AbortTaskRunError, idempotencyKeys, logger, schemaTask } from "@trigger.dev/sdk";
import { localeForUser } from "@/features/localization/queries";
import { LOCALE_CODE } from "@/i18n/routing";
import { buildSlackMessage } from "@/lib/alerts/blocks";
import { type AlertContext, presentAlert } from "@/lib/alerts/registry";
import { type OpsAlertPayload, opsAlertPayloadSchema } from "@/lib/alerts/schema";
import { taskEnv } from "@/lib/env";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * The alert task (spec 0006, AC-2, AC-11): presents the alert through the registry (resolving the
 * person behind a `client.signed_up` from the user id, never their email address), builds Block
 * Kit and posts it to the Slack incoming webhook. An unset webhook logs the alert as skipped and
 * returns `posted: false`; a 429 or 5xx throws so Trigger.dev retries; another 4xx aborts. A
 * final failure reaches Sentry through the global hook and never raises an alert about itself.
 * Runs in the Trigger.dev EU environment.
 */
export const opsAlertTask = schemaTask({
  id: "ops-alert",
  schema: opsAlertPayloadSchema,
  run: async (payload) => {
    const env = taskEnv();
    if (!env.OPS_ALERT_WEBHOOK_URL) {
      logger.warn("ops alert skipped: OPS_ALERT_WEBHOOK_URL is not set", {
        kind: payload.kind,
        fields: payload.fields,
      });
      return { posted: false };
    }

    const context = await resolveContext(payload, env);
    const view = presentAlert(payload.kind, payload.fields, context);
    const message = buildSlackMessage(view, {
      link: payload.link,
      externalUrl: payload.externalUrl,
      appUrl: env.NEXT_PUBLIC_APP_URL,
    });

    const response = await fetch(env.OPS_ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
    });
    if (response.ok) {
      logger.info("ops alert posted", { kind: payload.kind });
      return { posted: true };
    }
    const body = await response.text().catch(() => "");
    if (response.status === 429 || response.status >= 500) {
      throw new Error(`slack webhook answered ${response.status}: ${body}`);
    }
    throw new AbortTaskRunError(`slack webhook refused the alert (${response.status}): ${body}`);
  },
});

/** The person behind a sign up, resolved from the user id with the service client; the time is now. */
async function resolveContext(
  payload: OpsAlertPayload,
  env: ReturnType<typeof taskEnv>,
): Promise<AlertContext> {
  const now = new Date();
  if (payload.kind !== "client.signed_up") return { now };
  const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
  const [locale, { data: profile, error }] = await Promise.all([
    localeForUser(supabase, payload.fields.userId),
    supabase.from("profiles").select("full_name").eq("id", payload.fields.userId).maybeSingle(),
  ]);
  if (error) throw queryError(error);
  return { now, person: { fullName: profile?.full_name ?? "", language: LOCALE_CODE[locale] } };
}

/**
 * Raises an alert from inside another task (AC-7): the caller's key becomes the global
 * Trigger.dev key; a failed trigger is logged and never fails the calling task. Tasks only;
 * request code uses `sendOpsAlert`.
 */
export async function raiseAlertFromTask(alert: OpsAlertPayload): Promise<void> {
  try {
    const idempotencyKey = await idempotencyKeys.create(alert.idempotencyKey, { scope: "global" });
    await opsAlertTask.trigger(alert, { idempotencyKey });
  } catch (error) {
    logger.warn("ops alert trigger failed", { kind: alert.kind, reason: String(error) });
  }
}
