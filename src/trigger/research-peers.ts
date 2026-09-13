import "./instrumentation";

import * as Sentry from "@sentry/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AbortTaskRunError, idempotencyKeys, schemaTask, tasks, wait } from "@trigger.dev/sdk";
import { z } from "zod";
import { sectionNameEn, sectionOfDivision } from "@/features/benchmark/catalogue";
import {
  type PeerStatus,
  type PeersSummary,
  parseSummary,
  type ResearchSummary,
} from "@/features/research/summary";
import { regionCountriesOf } from "@/lib/countries";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createFixtureProvider } from "@/lib/research/fixture";
import { createParallelProvider } from "@/lib/research/parallel";
import { buildPeerOutputSchema, type PeerSearchInput } from "@/lib/research/peer-schema";
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  type ResearchProvider,
} from "@/lib/research/provider";
import { type KeptPeer, resolvePeers } from "@/lib/research/resolve-peers";
import { validatePeers } from "@/lib/research/validate-peers";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import type { benchmarkCompanyTask } from "./benchmark-company";
import { researchQueue } from "./queues";

type Service = SupabaseClient<Database>;
type RunRow = Tables<"research_runs">;
type CompanyRow = Tables<"companies">;

/** The ids every read and write is keyed by, taken from the loaded run row (AC-5). */
type RunIds = {
  readonly runId: string;
  readonly organizationId: string;
  readonly companyId: string;
};

/** Seconds between two provider status checks (AC-6), as for the client run. */
const POLL_SECONDS = 15;
/** The peer search's own wall clock budget, from this task's own start (AC-5). */
const BUDGET_MS = 20 * 60 * 1000;
/** How many peers the search aims for and the fewest that make a comparison (AC-5). */
const TARGET_PEERS = 8;
const MINIMUM_PEERS = 3;
/** Postgres: unique violation, which a retried insert of the same rows raises (AC-10). */
const UNIQUE_VIOLATION = "23505";

export const researchPeersPayloadSchema = z.object({ runId: z.uuid() });

/**
 * The peer search task (spec 0022, AC-5 to AC-8, AC-10): a second provider run on the same research
 * run, asking for up to eight companies of the client's NACE section rather than facts about the
 * client. It runs after `research-company`'s terminal write and never touches the run's `status` or
 * `error_code`: its only channel is `summary.peers`, so a peer failure leaves a succeeded run
 * succeeded and raises no alert. The provider's printed rates are converted to per million hours in
 * code, one structured call checks each against its cited page, a peer that is the client under
 * another name is dropped, the rung is climbed in code, and the kept rates land in `research_peers`
 * in one insert. Whatever the outcome, the last step triggers `benchmark-company` under
 * `benchmark/run/<runId>` so the loss still computes. Runs in the Trigger.dev EU environment.
 */
export const researchPeersTask = schemaTask({
  id: "research-peers",
  schema: researchPeersPayloadSchema,
  queue: researchQueue,
  maxDuration: 1500,
  retry: { maxAttempts: 3 },
  run: async (payload, { ctx }) => {
    const startedAtMs = Date.now();
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const run = await loadRun(supabase, payload.runId);
    const ids: RunIds = {
      runId: run.id,
      organizationId: run.organization_id,
      companyId: run.company_id,
    };
    const step = (message: string, fields: Record<string, unknown> = {}) =>
      log.info(message, { ...ids, elapsedMs: Date.now() - startedAtMs, ...fields });
    const overBudget = () => Date.now() - startedAtMs > BUDGET_MS;

    const company = await loadCompany(supabase, ids);
    const section = sectionOfDivision(company.industry_code);
    if (!section) {
      // No section means no search to make: the client run found no industry code, so the provider
      // has nothing to match peers against (AC-5).
      step("peer search skipped: the company has no industry section", {
        industryCode: company.industry_code,
      });
      await writePeersSummary(supabase, ids, {
        status: "skipped",
        found: 0,
        rung: null,
        thin: true,
        durationMs: Date.now() - startedAtMs,
      });
      await triggerBenchmark(ids, ctx.run.id);
      return { status: "skipped" as const };
    }

    const input: PeerSearchInput = {
      companyName: company.name,
      section,
      sectionName: sectionNameEn(section),
      country: company.country,
      regionCountries: regionCountriesOf(company.country),
      targetPeers: TARGET_PEERS,
      minimumPeers: MINIMUM_PEERS,
    };
    const fixture = env.RESEARCH_PROVIDER === "fixture";
    const provider: ResearchProvider = fixture
      ? createFixtureProvider()
      : createParallelProvider(env.PARALLEL_API_KEY ?? "");
    step("peer search started", {
      attempt: ctx.attempt.number,
      provider: env.RESEARCH_PROVIDER,
      section,
      peerProviderRunId: run.peer_provider_run_id,
    });

    // The peer run is created once and its id stored before the first poll, so a retry resumes it
    // instead of paying for a second search (AC-6).
    let peerRunId = run.peer_provider_run_id;
    if (!peerRunId) {
      const created = await classifyProviderCall(() =>
        provider.createPeerRun(input, buildPeerOutputSchema()),
      );
      peerRunId = created.providerRunId;
      await patchRun(supabase, ids, { peer_provider_run_id: peerRunId });
      step("peer provider run created", { peerProviderRunId: peerRunId });
    }

    for (;;) {
      const { status } = await classifyProviderCall(() => provider.getRun(peerRunId as string));
      if (status === "done") break;
      if (status === "failed") {
        throw new AbortTaskRunError("peer_rejected: the provider reported the peer run as failed");
      }
      if (overBudget()) {
        throw new AbortTaskRunError("peer_timeout: no peer result within 20 minutes");
      }
      if (!fixture) await wait.for({ seconds: POLL_SECONDS });
    }
    const result = await classifyProviderCall(() => provider.getPeerResult(peerRunId as string));
    step("peer result received", { peerProviderRunId: peerRunId, returned: result.peers.length });

    const validation = await validatePeers({
      company: {
        name: company.name,
        country: company.country,
        section,
        sectionName: input.sectionName,
      },
      peers: result.peers,
      apiKey: env.AI_GATEWAY_API_KEY,
      onError: (error) => reportToSentry(error, ids, ctx.run.id),
    });
    const resolved = resolvePeers({
      peers: result.peers,
      verdicts: validation?.verdicts ?? null,
      clientName: company.name,
      clientWebsite: company.website,
      country: company.country,
      regionCountries: input.regionCountries,
    });
    step("peers resolved", {
      returned: result.peers.length,
      kept: resolved.kept.length,
      dropped: resolved.dropped.length,
      rung: resolved.rung,
      thin: resolved.thin,
      validation: validation ? "passed" : "skipped",
    });

    await insertPeers(supabase, ids, section, resolved.kept, resolved.rung);
    await writePeersSummary(supabase, ids, {
      status: "ok",
      found: resolved.kept.length,
      rung: resolved.rung,
      thin: resolved.thin,
      dropped: [...resolved.dropped],
      validation: validation ? "passed" : "skipped",
      promptVersion: validation?.promptVersion,
      durationMs: Date.now() - startedAtMs,
    });
    await triggerBenchmark(ids, ctx.run.id);
    return { status: "ok" as const, found: resolved.kept.length, rung: resolved.rung };
  },
  onFailure: async ({ payload, error, ctx }) => {
    // After the last attempt: the peer search reports through the summary alone and raises no alert
    // (AC-7). The benchmark is still triggered, under the same key the happy path uses, so the loss
    // computes from the client's own figures.
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const { data: run } = await supabase
      .from("research_runs")
      .select("id, organization_id, company_id")
      .eq("id", payload.runId)
      .maybeSingle();
    if (!run) return;
    const ids: RunIds = {
      runId: run.id,
      organizationId: run.organization_id,
      companyId: run.company_id,
    };
    const status = peerStatusOf(error);
    log.warn("peer search failed after the last attempt; the run is untouched", {
      ...ids,
      status,
      reason: error instanceof Error ? error.message : String(error),
      triggerRunId: ctx.run.id,
    });
    reportToSentry(error, ids, ctx.run.id);
    await writePeersSummary(supabase, ids, {
      status,
      found: 0,
      rung: null,
      thin: true,
      reason: PEER_SAFE_MESSAGES[status],
    });
    await triggerBenchmark(ids, ctx.run.id);
  },
});

/** Short safe sentences per failing peer status, stored on `summary.peers.reason` (AC-7). */
const PEER_SAFE_MESSAGES: Record<PeerStatus, string> = {
  ok: "",
  skipped: "The company has no industry section to search peers in.",
  failed: "The peer search failed.",
  timeout: "The peer search did not finish within 20 minutes.",
};

/**
 * The status a failed peer search reports (AC-7): `timeout` when the budget or the provider's clock
 * ran out, `failed` for everything else. Pure.
 */
export function peerStatusOf(error: unknown): PeerStatus {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /^peer_timeout\b/.test(message) ? "timeout" : "failed";
}

/**
 * Queues the benchmark computation (AC-7): the key `benchmark/run/<runId>` is the one
 * `research-company` uses too, so however many of the three paths fire, one computation runs. A
 * trigger failure is logged and reported and changes nothing about the run.
 */
async function triggerBenchmark(ids: RunIds, triggerRunId: string): Promise<void> {
  try {
    const idempotencyKey = await idempotencyKeys.create(`benchmark/run/${ids.runId}`, {
      scope: "global",
    });
    const handle = await tasks.trigger<typeof benchmarkCompanyTask>(
      "benchmark-company",
      { companyId: ids.companyId, triggerKind: "research", researchRunId: ids.runId },
      { idempotencyKey, idempotencyKeyTTL: "24h" },
    );
    log.info("benchmark queued after the peer search", { ...ids, benchmarkRunId: handle.id });
  } catch (error) {
    log.warn("benchmark trigger failed after the peer search", {
      ...ids,
      reason: error instanceof Error ? error.message : String(error),
    });
    reportToSentry(error, ids, triggerRunId);
  }
}

/** Maps provider errors to the retry classes (AC-6): rejected aborts, unavailable throws for a retry. */
async function classifyProviderCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ProviderRejectedError) {
      throw new AbortTaskRunError(`peer_rejected: ${error.message}`);
    }
    if (error instanceof ProviderUnavailableError) {
      throw new ProviderUnavailableError(`peer_unavailable: ${error.message}`, error.status);
    }
    throw error;
  }
}

async function loadRun(supabase: Service, runId: string): Promise<RunRow> {
  const { data, error } = await supabase
    .from("research_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!data) throw new AbortTaskRunError(`internal: research run ${runId} not found`);
  return data;
}

async function loadCompany(supabase: Service, ids: RunIds): Promise<CompanyRow> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("id", ids.companyId)
    .eq("organization_id", ids.organizationId)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!data) throw new AbortTaskRunError(`internal: company ${ids.companyId} not found`);
  return data;
}

/** Updates the run keyed by its ids; never writes `status` or `error_code` (AC-7). */
async function patchRun(
  supabase: Service,
  ids: RunIds,
  patch: Pick<
    Database["public"]["Tables"]["research_runs"]["Update"],
    "peer_provider_run_id" | "summary"
  >,
): Promise<void> {
  const { error } = await supabase
    .from("research_runs")
    .update(patch)
    .eq("id", ids.runId)
    .eq("organization_id", ids.organizationId)
    .eq("company_id", ids.companyId);
  if (error) throw queryError(error);
}

/**
 * Merges `peers` into the run's stored summary (AC-7). The client task owns every other field, so
 * the current summary is re-read and spread rather than rebuilt: this task runs after that task's
 * terminal write and must not undo it.
 */
async function writePeersSummary(
  supabase: Service,
  ids: RunIds,
  peers: PeersSummary,
): Promise<void> {
  const { data, error } = await supabase
    .from("research_runs")
    .select("summary")
    .eq("id", ids.runId)
    .eq("organization_id", ids.organizationId)
    .maybeSingle();
  if (error) throw queryError(error);
  const current: ResearchSummary = parseSummary(data?.summary) ?? { version: 1, step: "done" };
  await patchRun(supabase, ids, { summary: { ...current, peers } });
}

/**
 * Inserts one `research_peers` row per kept peer and rate in one statement (AC-10). A retry that
 * already wrote them raises the unique violation on `(research_run_id, peer_name, kpi_key)`, which
 * means the rows of this run are already there: PostgREST cannot name that index for
 * `on conflict do nothing`, so the violation is read as "already stored" and swallowed.
 */
async function insertPeers(
  supabase: Service,
  ids: RunIds,
  section: string,
  kept: readonly KeptPeer[],
  rung: string | null,
): Promise<void> {
  if (kept.length === 0 || !rung) return;
  const rows = kept.flatMap((peer) =>
    peer.rates.map((rate) => ({
      organization_id: ids.organizationId,
      company_id: ids.companyId,
      research_run_id: ids.runId,
      peer_name: peer.name,
      peer_website: peer.website,
      peer_country: peer.country,
      industry_section: section,
      headcount: peer.headcount,
      headcount_year: peer.headcountYear,
      kpi_key: rate.kpiKey,
      period_year: rate.periodYear,
      value: rate.value,
      value_as_published: rate.valueAsPublished,
      unit_as_published: rate.unitAsPublished,
      basis: rate.basis,
      source_url: rate.sourceUrl,
      source_title: rate.sourceTitle,
      confidence: rate.confidence,
      rung,
    })),
  );
  const { error } = await supabase.from("research_peers").insert(rows);
  if (!error) return;
  if (error.code !== UNIQUE_VIOLATION) throw queryError(error);
  log.info("peer rows already stored by an earlier attempt", { ...ids, rows: rows.length });
}

function reportToSentry(error: unknown, ids: RunIds, triggerRunId: string): void {
  Sentry.captureException(error, {
    tags: { research_run_id: ids.runId, source: "research-peers" },
    extra: { ...ids, triggerRunId },
  });
}
