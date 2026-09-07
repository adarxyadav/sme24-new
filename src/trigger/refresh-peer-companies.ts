import "./instrumentation";

import { schedules } from "@trigger.dev/sdk";
import {
  HOUSE_ORGANIZATION_ID,
  PEER_REFRESH_BATCH,
  PEER_REFRESH_MAX_FAILURES,
  PEER_REFRESH_MONTHS,
  refreshDueBefore,
} from "@/features/peers/catalogue";
import { startPeerRuns } from "@/features/peers/runs";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { raiseAlertFromTask } from "./ops-alert";

/**
 * The peer refresh schedule (spec 0012, AC-14, AC-15): once a day, the approved peers whose
 * `researched_at` is older than twelve months (or null) and whose consecutive failures are still
 * below the limit get a fresh research run, at most `PEER_REFRESH_BATCH` per run, through the
 * same path the ops action uses. A peer that failed three times in a row is skipped here and
 * flagged for ops on `/admin/peers`, so a permanently unresearchable peer cannot retry forever.
 * A refresh writes new `company_kpis` rows and touches no existing snapshot; clients pick the
 * new values up at their next computation. Throws on a database error so Trigger.dev retries.
 * Runs in the Trigger.dev EU environment on the service client.
 */
export const refreshPeerCompaniesTask = schedules.task({
  id: "refresh-peer-companies",
  cron: "30 3 * * *",
  maxDuration: 300,
  run: async (_payload, { ctx }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const dueBefore = refreshDueBefore(new Date()).toISOString();

    const { data: due, error } = await supabase
      .from("peer_companies")
      .select("id, company_id, researched_at, failed_refreshes")
      .eq("status", "approved")
      .lt("failed_refreshes", PEER_REFRESH_MAX_FAILURES)
      .or(`researched_at.is.null,researched_at.lt.${dueBefore}`)
      .order("researched_at", { ascending: true, nullsFirst: true })
      .limit(PEER_REFRESH_BATCH);
    if (error) throw queryError(error);

    const { count: flagged, error: flaggedError } = await supabase
      .from("peer_companies")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved")
      .gte("failed_refreshes", PEER_REFRESH_MAX_FAILURES);
    if (flaggedError) throw queryError(flaggedError);

    if (due.length === 0) {
      log.info("no peer is due for a refresh", {
        organizationId: HOUSE_ORGANIZATION_ID,
        months: PEER_REFRESH_MONTHS,
        flagged: flagged ?? 0,
      });
      return { triggered: 0, skipped: 0, flagged: flagged ?? 0 };
    }

    // `requested_by` is null: the schedule has no user, and the column is nullable for exactly this.
    const result = await startPeerRuns(
      supabase,
      due.map((peer) => peer.id),
      null,
    );
    log.info("peer refresh run", {
      organizationId: HOUSE_ORGANIZATION_ID,
      due: due.length,
      triggered: result.triggered.length,
      skipped: result.skipped.length,
      flagged: flagged ?? 0,
    });
    if ((flagged ?? 0) > 0) {
      await raiseAlertFromTask({
        kind: "peers.refresh_flagged",
        fields: { flagged: flagged ?? 0, limit: PEER_REFRESH_MAX_FAILURES },
        link: "/admin/peers",
        idempotencyKey: `peers-flagged/${new Date().toISOString().slice(0, 10)}`,
      });
    }
    return {
      triggered: result.triggered.length,
      skipped: result.skipped.length,
      flagged: flagged ?? 0,
      scheduleRunId: ctx.run.id,
    };
  },
});
