import "./instrumentation";

import { logger, task } from "@trigger.dev/sdk";
import { localeForUser } from "@/features/localization/queries";
import { routing } from "@/i18n/routing";
import { createTranslatorFor } from "@/i18n/standalone";
import { taskEnv } from "@/lib/env";
import { createServiceClient } from "@/lib/supabase/service";

export type ScaffoldCheckPayload = {
  message: string;
  /** When true the task throws after writing its row, to prove task errors reach Sentry. */
  shouldFail?: boolean;
  /** The user whose stored language the summary is written in; without it the default locale (spec 0004, AC-7). */
  userId?: string;
};

/**
 * Smoke test task: writes a row with the service client, updates its status, optionally fails.
 * The row's message carries the payload message plus a translated summary with the insert time in
 * the user's language (spec 0004), which proves the standalone translator end to end.
 * Runs in the Trigger.dev EU environment; the ops admin page shows the row through Realtime.
 */
export const scaffoldCheck = task({
  id: "scaffold-check",
  retry: { maxAttempts: 1 },
  run: async (payload: ScaffoldCheckPayload, { ctx }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

    const locale = payload.userId
      ? await localeForUser(supabase, payload.userId)
      : routing.defaultLocale;
    const t = await createTranslatorFor(locale);
    const message = `${payload.message} · ${t("scaffold.summary", { at: new Date() })}`;

    const { data: row, error } = await supabase
      .from("scaffold_checks")
      .insert({ run_id: ctx.run.id, message, status: "running" })
      .select("id")
      .single();
    if (error) throw error;

    logger.info("scaffold check row written", { id: row.id, runId: ctx.run.id, locale });

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
