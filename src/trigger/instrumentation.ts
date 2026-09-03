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
});
