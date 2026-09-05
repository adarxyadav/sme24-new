"use server";

import * as Sentry from "@sentry/nextjs";
import { tasks } from "@trigger.dev/sdk";
import { captureServerEvent } from "@/lib/analytics/server";
import { roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import type { scaffoldCheck } from "@/trigger/scaffold-check";

export type ScaffoldResult =
  | { key: "taskQueued"; runId: string }
  | { key: "taskUnavailable" }
  | { key: "sentrySent" }
  | { key: "sentryUnavailable" }
  | { key: "posthogSent" }
  | { key: "posthogUnavailable" };

/** Authorization lives in the action too, not only in the proxy. */
async function requireOps() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops") throw new Error("Forbidden: ops role required");
  return { userId: String(claims?.sub ?? ""), email: String(claims?.email ?? "") };
}

export async function runScaffoldTask(
  _previous: ScaffoldResult | null,
  formData: FormData,
): Promise<ScaffoldResult> {
  const actor = await requireOps();
  const env = serverEnv();
  if (!env.TRIGGER_SECRET_KEY) return { key: "taskUnavailable" };

  const shouldFail = formData.get("shouldFail") === "true";
  // The task writes its summary in the actor's stored language (spec 0004, AC-7).
  const handle = await tasks.trigger<typeof scaffoldCheck>("scaffold-check", {
    message: `Triggered by ${actor.email}`,
    shouldFail,
    userId: actor.userId,
  });
  log.info("scaffold task triggered", { runId: handle.id, shouldFail, userId: actor.userId });
  return { key: "taskQueued", runId: handle.id };
}

export async function sendSentryTestError(): Promise<ScaffoldResult> {
  const actor = await requireOps();
  const env = serverEnv();
  if (!env.SENTRY_DSN) return { key: "sentryUnavailable" };

  Sentry.captureException(new Error("SME24 scaffold: test error from a server action"), {
    tags: { source: "scaffold-check" },
    user: { id: actor.userId },
  });
  await Sentry.flush(2_000);
  return { key: "sentrySent" };
}

export async function sendPostHogTestEvent(): Promise<ScaffoldResult> {
  const actor = await requireOps();
  const sent = await captureServerEvent({
    distinctId: actor.userId,
    event: "scaffold_test_event",
    properties: { source: "scaffold-check" },
  });
  return sent ? { key: "posthogSent" } : { key: "posthogUnavailable" };
}
