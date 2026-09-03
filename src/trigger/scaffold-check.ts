import "./instrumentation";

import { logger, task } from "@trigger.dev/sdk";
import { taskEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";

export type ScaffoldCheckPayload = {
  message: string;
  /** When true the task throws after writing its row, to prove task errors reach Sentry. */
  shouldFail?: boolean;
};

/**
 * Smoke test task: writes a row with the service client, updates its status, optionally fails.
 * Runs in the Trigger.dev EU environment; the ops admin page shows the row through Realtime.
 */
export const scaffoldCheck = task({
  id: "scaffold-check",
  retry: { maxAttempts: 1 },
  run: async (payload: ScaffoldCheckPayload, { ctx }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

    const { data: row, error } = await supabase
      .from("scaffold_checks")
      .insert({ run_id: ctx.run.id, message: payload.message, status: "running" })
      .select("id")
      .single();
    if (error) throw error;

    logger.info("scaffold check row written", { id: row.id, runId: ctx.run.id });

    if (payload.shouldFail) {
      await supabase.from("scaffold_checks").update({ status: "failed" }).eq("id", row.id);
      throw new Error("SME24 scaffold: test failure from a Trigger.dev task");
    }

    const { error: updateError } = await supabase
      .from("scaffold_checks")
      .update({ status: "done" })
      .eq("id", row.id);
    if (updateError) throw updateError;

    return { id: row.id };
  },
});
