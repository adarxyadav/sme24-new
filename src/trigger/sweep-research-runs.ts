import "./instrumentation";

import { logger, schedules } from "@trigger.dev/sdk";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/service";
import { raiseAlertFromTask } from "./ops-alert";

/** A run `queued` for longer than this is stuck (spec 0007, AC-11). */
export const STALE_QUEUED_MINUTES = 30;
/** A run `running` for longer than this is stuck (AC-11). */
export const STALE_RUNNING_MINUTES = 60;

const STALE_MESSAGE = "The run was stuck and was closed by the sweep.";

/**
 * The stale sweep (spec 0007, AC-11): every 15 minutes, runs `queued` for more than 30 minutes
 * and `running` for more than 60 minutes become `failed` with `stale`, each update guarded by the
 * row's current status, one alert per swept run (keyed `research-stale/<runId>`), counts in the
 * log. A swept row frees the open run slot; a task attempt that reaches its terminal write later
 * finds zero rows under its guard. Runs in the Trigger.dev EU environment on the service client.
 */
export const sweepResearchRunsTask = schedules.task({
  id: "sweep-research-runs",
  cron: "*/15 * * * *",
  run: async () => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const now = Date.now();
    const queuedSwept = await sweep(
      supabase,
      "queued",
      "created_at",
      now - STALE_QUEUED_MINUTES * 60_000,
    );
    const runningSwept = await sweep(
      supabase,
      "running",
      "started_at",
      now - STALE_RUNNING_MINUTES * 60_000,
    );
    log.info("research runs swept", { queuedSwept, runningSwept });
    return { queuedSwept, runningSwept };
  },
});

type Service = ReturnType<typeof createServiceClient>;

async function sweep(
  supabase: Service,
  status: "queued" | "running",
  column: "created_at" | "started_at",
  olderThanMs: number,
): Promise<number> {
  const { data: stale, error } = await supabase
    .from("research_runs")
    .select("id, organization_id, company_id")
    .eq("status", status)
    .lt(column, new Date(olderThanMs).toISOString());
  if (error) throw error;
  let swept = 0;
  for (const run of stale ?? []) {
    const { data: closed, error: closeError } = await supabase
      .from("research_runs")
      .update({
        status: "failed",
        error_code: "stale",
        error_message: STALE_MESSAGE,
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("status", status)
      .select("id");
    if (closeError) throw closeError;
    if (closed.length === 0) continue;
    swept += 1;
    logger.warn("stale research run closed", { runId: run.id, status });
    const { data: organization } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", run.organization_id)
      .maybeSingle();
    await raiseAlertFromTask({
      kind: "research.run_failed",
      fields: {
        runId: run.id,
        organizationName: organization?.name ?? "Unknown organization",
        reason: `stale: ${status} for more than ${status === "queued" ? STALE_QUEUED_MINUTES : STALE_RUNNING_MINUTES} minutes`,
      },
      idempotencyKey: `research-stale/${run.id}`,
    });
  }
  return swept;
}
