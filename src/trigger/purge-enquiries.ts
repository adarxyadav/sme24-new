import "./instrumentation";

import { logger, schedules } from "@trigger.dev/sdk";
import { TIME_ZONE } from "@/i18n/formats";
import { taskEnv } from "@/lib/env";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";

/** The address hash is a flood guard only; after this many days it is nulled (spec 0009, AC-13). */
export const IP_HASH_RETENTION_DAYS = 30;
/** Closed enquiries are deleted this many days after they were handled. */
export const CLOSED_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Weekly retention of the enquiries (spec 0009, AC-13): nulls `ip_hash` on rows older than 30
 * days and deletes closed rows whose `handled_at` is older than 12 months, logging both counts.
 * Neither change is audited (the trigger fires on status and note only); the counts here are the
 * record. Mondays at 03:00 Zurich time, in the Trigger.dev EU environment with the service client.
 */
export const purgeEnquiries = schedules.task({
  id: "purge-enquiries",
  cron: { pattern: "0 3 * * 1", timezone: TIME_ZONE },
  run: async () => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const now = Date.now();
    const hashCutoff = new Date(now - IP_HASH_RETENTION_DAYS * DAY_MS).toISOString();
    const closedCutoff = new Date(now - CLOSED_RETENTION_DAYS * DAY_MS).toISOString();

    const { count: hashed, error: hashError } = await supabase
      .from("enquiries")
      .update({ ip_hash: null }, { count: "exact" })
      .not("ip_hash", "is", null)
      .lt("created_at", hashCutoff);
    if (hashError) throw queryError(hashError);

    const { count: deleted, error: deleteError } = await supabase
      .from("enquiries")
      .delete({ count: "exact" })
      .eq("status", "closed")
      .lt("handled_at", closedCutoff);
    if (deleteError) throw queryError(deleteError);

    const result = { hashesCleared: hashed ?? 0, deleted: deleted ?? 0 };
    logger.info("enquiries purged", { ...result, hashCutoff, closedCutoff });
    return result;
  },
});
