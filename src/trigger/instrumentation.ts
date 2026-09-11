import * as Sentry from "@sentry/node";
import { tasks } from "@trigger.dev/sdk";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Task side observability. Imported by every task module so it runs once per task process.
 * Errors from any task go to Sentry (EU region DSN) through the global onFailure hook.
 */
const env = taskEnv();

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.TRIGGER_ENVIRONMENT ?? process.env.NODE_ENV,
    // Spec 0017 (AC-10): the deploy a task error came from. Trigger.dev deploys carry the SHA of
    // the commit the worker was built from; undefined locally, like the app side.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
} else {
  log.warn("Sentry disabled in tasks: SENTRY_DSN is not set");
}

tasks.onFailure(async ({ ctx, error }) => {
  Sentry.captureException(error, {
    tags: { taskId: ctx.task.id, runId: ctx.run.id, source: "trigger.dev" },
  });
  await Sentry.flush(2_000);
  await raiseTaskFailedAlert(ctx, error);
});

/**
 * Raises the `task.failed` ops alert after a run exhausts its retries (spec 0017, AC-9). Best
 * effort in two senses: the alert module is imported dynamically, because `ops-alert.ts` imports
 * this file and a static import back would be a cycle; and every failure here is swallowed, so a
 * Slack outage can never mask the task failure that Sentry has already recorded. The run page is
 * the button target rather than an admin path, since that is where the failure is reproduced.
 * Tasks only, once per run.
 */
async function raiseTaskFailedAlert(
  ctx: Parameters<Parameters<typeof tasks.onFailure>[0]>[0]["ctx"],
  error: unknown,
): Promise<void> {
  try {
    const { raiseAlertFromTask } = await import("./ops-alert");
    const message = error instanceof Error ? error.message : String(error ?? "");
    await raiseAlertFromTask({
      kind: "task.failed",
      fields: {
        taskId: ctx.task.id,
        runId: ctx.run.id,
        attempts: ctx.attempt.number,
        error: message.slice(0, 500) || "unknown error",
      },
      externalUrl: `https://cloud.trigger.dev/projects/v3/${ctx.project.ref}/runs/${ctx.run.id}`,
      idempotencyKey: `task-failed/${ctx.run.id}`,
    });
  } catch (alertError) {
    log.warn("task.failed alert could not be raised", {
      taskId: ctx.task.id,
      runId: ctx.run.id,
      reason: String(alertError),
    });
  }
}
