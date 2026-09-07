import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import type { researchCompanyTask } from "@/trigger/research-company";
import { HOUSE_ORGANIZATION_ID } from "./catalogue";

/**
 * Starting peer research runs (spec 0012, AC-4, AC-14): the one path the ops action, the rerun
 * and the daily refresh share. Takes the service client, because an ops token never carries the
 * house organization and the members insert policy would refuse the row. The submitted ids are a
 * request: every peer is re read, one that is no longer approved or already has an open run is
 * skipped, the open run index is the backstop for two writers, the house quota trigger bounds a
 * loop, and the unchanged `research-company` task is triggered with the new run id under
 * `research/peer/<runId>`. Server only (actions and tasks).
 */

type Service = SupabaseClient<Database>;

export const PEER_SKIP_REASONS = [
  "not_approved",
  "run_in_progress",
  "quota_exceeded",
  "trigger_failed",
] as const;
export type PeerSkipReason = (typeof PEER_SKIP_REASONS)[number];

export type PeerSkip = { readonly peerId: string; readonly reason: PeerSkipReason };
export type PeerRunStarted = {
  readonly peerId: string;
  readonly companyId: string;
  readonly runId: string;
};

export type StartPeerRunsResult = {
  readonly triggered: readonly PeerRunStarted[];
  readonly skipped: readonly PeerSkip[];
};

/** Postgres: unique violation (the one open run per company index). */
const UNIQUE_VIOLATION = "23505";
/** The house quota trigger's code (`private.check_house_run_quota`). */
const QUOTA_EXCEEDED = "SM429";
/** How long the global key blocks a second trigger of the same run. */
const IDEMPOTENCY_TTL = "24h";

/**
 * The approved peers among `peerIds`, re read at trigger time (AC-4): id, company and whether a
 * run is open. Any id not returned is not approved (or not a peer at all). Service client.
 */
export async function readApprovedPeers(
  supabase: Service,
  peerIds: readonly string[],
): Promise<
  ReadonlyArray<{ readonly peerId: string; readonly companyId: string; readonly openRun: boolean }>
> {
  if (peerIds.length === 0) return [];
  const { data: peers, error } = await supabase
    .from("peer_companies")
    .select("id, company_id, company:companies!inner(organization_id)")
    .in("id", [...peerIds])
    .eq("status", "approved")
    .eq("company.organization_id", HOUSE_ORGANIZATION_ID);
  if (error) throw queryError(error);
  if (peers.length === 0) return [];
  const { data: open, error: openError } = await supabase
    .from("research_runs")
    .select("company_id")
    .eq("organization_id", HOUSE_ORGANIZATION_ID)
    .in(
      "company_id",
      peers.map((peer) => peer.company_id),
    )
    .in("status", ["queued", "running"]);
  if (openError) throw queryError(openError);
  const openCompanies = new Set(open.map((run) => run.company_id));
  return peers.map((peer) => ({
    peerId: peer.id,
    companyId: peer.company_id,
    openRun: openCompanies.has(peer.company_id),
  }));
}

/**
 * Starts one run per approved peer without an open run (AC-4): inserts the `research_runs` row
 * through the service client (house organization, `requested_by` the ops user or null for the
 * schedule), triggers `research-company` with the run id, stores the Trigger.dev run id, and on
 * a trigger failure closes the run as `trigger_failed` so the open run slot is freed. Every peer
 * that dropped out comes back in `skipped` with its reason. Service client.
 */
export async function startPeerRuns(
  supabase: Service,
  peerIds: readonly string[],
  requestedBy: string | null,
): Promise<StartPeerRunsResult> {
  const approved = await readApprovedPeers(supabase, peerIds);
  const approvedIds = new Set(approved.map((peer) => peer.peerId));
  const skipped: PeerSkip[] = [...new Set(peerIds)]
    .filter((peerId) => !approvedIds.has(peerId))
    .map((peerId) => ({ peerId, reason: "not_approved" as const }));
  const triggered: PeerRunStarted[] = [];
  for (const peer of approved) {
    if (peer.openRun) {
      skipped.push({ peerId: peer.peerId, reason: "run_in_progress" });
      continue;
    }
    const outcome = await startOne(supabase, peer, requestedBy);
    if (outcome.ok) triggered.push(outcome.run);
    else skipped.push({ peerId: peer.peerId, reason: outcome.reason });
  }
  log.info("peer research runs started", {
    requested: peerIds.length,
    triggered: triggered.length,
    skipped: skipped.length,
    requestedBy,
  });
  return { triggered, skipped };
}

async function startOne(
  supabase: Service,
  peer: { readonly peerId: string; readonly companyId: string },
  requestedBy: string | null,
): Promise<
  | { readonly ok: true; readonly run: PeerRunStarted }
  | { readonly ok: false; readonly reason: PeerSkipReason }
> {
  const { data: run, error } = await supabase
    .from("research_runs")
    .insert({
      organization_id: HOUSE_ORGANIZATION_ID,
      company_id: peer.companyId,
      requested_by: requestedBy,
      status: "queued",
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "run_in_progress" };
    if (error.code === QUOTA_EXCEEDED) return { ok: false, reason: "quota_exceeded" };
    throw queryError(error);
  }
  try {
    const idempotencyKey = await idempotencyKeys.create(`research/peer/${run.id}`, {
      scope: "global",
    });
    const handle = await tasks.trigger<typeof researchCompanyTask>(
      "research-company",
      { runId: run.id },
      { idempotencyKey, idempotencyKeyTTL: IDEMPOTENCY_TTL },
    );
    const { error: storeError } = await supabase
      .from("research_runs")
      .update({ trigger_run_id: handle.id })
      .eq("id", run.id)
      .eq("organization_id", HOUSE_ORGANIZATION_ID);
    if (storeError)
      log.warn("trigger_run_id not stored", { runId: run.id, reason: storeError.message });
    return { ok: true, run: { peerId: peer.peerId, companyId: peer.companyId, runId: run.id } };
  } catch (triggerError) {
    const reason = triggerError instanceof Error ? triggerError.message : String(triggerError);
    log.error("peer research trigger failed", { peerId: peer.peerId, runId: run.id, reason });
    const { error: closeError } = await supabase
      .from("research_runs")
      .update({
        status: "failed",
        error_code: "trigger_failed",
        error_message: "The research could not be started.",
        finished_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .eq("organization_id", HOUSE_ORGANIZATION_ID)
      .eq("status", "queued");
    if (closeError)
      log.warn("trigger_failed not stored", { runId: run.id, reason: closeError.message });
    return { ok: false, reason: "trigger_failed" };
  }
}
