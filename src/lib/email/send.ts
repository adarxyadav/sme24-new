import "server-only";

import * as Sentry from "@sentry/nextjs";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { sendEmailTask } from "@/trigger/send-email";
import type { NewSendPayload } from "./schema";

/** Failed triggers never throw (AC-15): the event site logs and moves on. */
export type TriggerResult =
  | { readonly ok: true; readonly runId: string }
  | { readonly ok: false; readonly error: "trigger_unavailable" | "trigger_failed" };

/** What a caller passes: the `new` payload without its discriminator. */
export type SendEmailRequest = Omit<NewSendPayload, "kind">;

/** How long a global idempotency key blocks a second welcome email for the same organization. */
const IDEMPOTENCY_TTL = "30d";

/**
 * Triggers the send-email task for a new email (spec 0006, AC-1, AC-15). The caller's
 * `idempotencyKey` becomes the global Trigger.dev key with a 30 day TTL, so a second trigger with
 * the same key is deduplicated before a run starts (and the unique column catches the rest). Never
 * throws: a missing `TRIGGER_SECRET_KEY` gives `trigger_unavailable`, an unreachable Trigger.dev
 * gives `trigger_failed`, both logged and (when deployed) sent to Sentry with the organization id.
 * Server actions and route handlers.
 */
export async function sendEmail(request: SendEmailRequest): Promise<TriggerResult> {
  if (!serverEnv().TRIGGER_SECRET_KEY) {
    log.warn("email not triggered: TRIGGER_SECRET_KEY is not set", {
      template: request.template,
      idempotencyKey: request.idempotencyKey,
    });
    return { ok: false, error: "trigger_unavailable" };
  }
  try {
    const idempotencyKey = await idempotencyKeys.create(request.idempotencyKey, {
      scope: "global",
    });
    const handle = await tasks.trigger<typeof sendEmailTask>(
      "send-email",
      { kind: "new", ...request },
      { idempotencyKey, idempotencyKeyTTL: IDEMPOTENCY_TTL },
    );
    log.info("email triggered", {
      runId: handle.id,
      template: request.template,
      sourceEvent: request.sourceEvent,
      organizationId: request.organizationId,
    });
    return { ok: true, runId: handle.id };
  } catch (error) {
    reportTriggerFailure("send-email", error, request.organizationId);
    return { ok: false, error: "trigger_failed" };
  }
}

/**
 * Triggers a retry of a failed delivery (AC-10): no Trigger.dev idempotency key, the unique row is
 * the guard. Never throws. Server actions (ops).
 */
export async function retryEmail(deliveryId: string): Promise<TriggerResult> {
  if (!serverEnv().TRIGGER_SECRET_KEY) return { ok: false, error: "trigger_unavailable" };
  try {
    const handle = await tasks.trigger<typeof sendEmailTask>("send-email", {
      kind: "retry",
      deliveryId,
    });
    log.info("email retry triggered", { runId: handle.id, deliveryId });
    return { ok: true, runId: handle.id };
  } catch (error) {
    reportTriggerFailure("send-email retry", error, undefined);
    return { ok: false, error: "trigger_failed" };
  }
}

/** Logs a failed trigger and, when deployed, reports it to Sentry with the organization id. Server only. */
export function reportTriggerFailure(
  what: string,
  error: unknown,
  organizationId: string | undefined,
): void {
  const reason = error instanceof Error ? error.message : String(error);
  log.warn(`${what} trigger failed`, { reason, organizationId });
  if (process.env.VERCEL_ENV) {
    Sentry.captureException(error, {
      tags: { source: "trigger", task: what },
      extra: { organizationId },
    });
  }
}
