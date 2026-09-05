import "server-only";

import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { reportTriggerFailure, type TriggerResult } from "@/lib/email/send";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { opsAlertTask } from "@/trigger/ops-alert";
import type { OpsAlertPayload } from "./schema";

/** A second alert with the same key inside this window is dropped before a run starts. */
const IDEMPOTENCY_TTL = "30d";

/**
 * Triggers the ops-alert task from request code (spec 0006, AC-2, AC-11): the caller's
 * `idempotencyKey` becomes the global Trigger.dev key. Never throws and never fails the caller: a
 * missing `TRIGGER_SECRET_KEY` gives `trigger_unavailable`, a failed trigger `trigger_failed`,
 * both logged and (when deployed) sent to Sentry. Server actions and route handlers; a task
 * raises alerts through `raiseAlertFromTask` instead.
 */
export async function sendOpsAlert(alert: OpsAlertPayload): Promise<TriggerResult> {
  if (!serverEnv().TRIGGER_SECRET_KEY) {
    log.warn("ops alert not triggered: TRIGGER_SECRET_KEY is not set", { kind: alert.kind });
    return { ok: false, error: "trigger_unavailable" };
  }
  try {
    const idempotencyKey = await idempotencyKeys.create(alert.idempotencyKey, { scope: "global" });
    const handle = await tasks.trigger<typeof opsAlertTask>("ops-alert", alert, {
      idempotencyKey,
      idempotencyKeyTTL: IDEMPOTENCY_TTL,
    });
    log.info("ops alert triggered", { runId: handle.id, kind: alert.kind });
    return { ok: true, runId: handle.id };
  } catch (error) {
    reportTriggerFailure("ops-alert", error, undefined);
    return { ok: false, error: "trigger_failed" };
  }
}
