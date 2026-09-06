import "./instrumentation";

import { logger, schedules } from "@trigger.dev/sdk";
import { TIME_ZONE } from "@/i18n/formats";
import { taskEnv } from "@/lib/env";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";

/** Deliveries older than this are gone (spec 0006, AC-12); notifications keep their own life. */
export const RETENTION_DAYS = 90;

/**
 * Weekly retention of the outbox (spec 0006, AC-12): deletes `email_deliveries` rows older than
 * 90 days (a notification's `delivery_id` becomes null through the foreign key) and logs the
 * count. Mondays at 03:00 Zurich time, in the Trigger.dev EU environment with the service client.
 */
export const purgeEmailDeliveries = schedules.task({
  id: "purge-email-deliveries",
  cron: { pattern: "0 3 * * 1", timezone: TIME_ZONE },
  run: async () => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1_000).toISOString();

    const { count, error } = await supabase
      .from("email_deliveries")
      .delete({ count: "exact" })
      .lt("created_at", cutoff);
    if (error) throw queryError(error);

    const deleted = count ?? 0;
    logger.info("email deliveries purged", { deleted, cutoff });
    return { deleted };
  },
});
