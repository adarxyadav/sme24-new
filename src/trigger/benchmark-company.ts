import "./instrumentation";

import * as Sentry from "@sentry/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotencyKeys, queue, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { MODEL_VERSION, TRIGGER_KINDS, type TriggerKind } from "@/features/benchmark/catalogue";
import { roundMoney } from "@/features/benchmark/loss";
import { computeBenchmark, type ModelKpiRow, type ModelPeerRow } from "@/features/benchmark/model";
import { SNAPSHOT_SCHEMAS, type SnapshotBody } from "@/features/benchmark/snapshot";
import { localeForUser } from "@/features/localization/queries";
import { isKpiKey } from "@/features/research/catalogue";
import { PEER_RUNGS, type PeerRung, parseSummary } from "@/features/research/summary";
import { LOCALE_CODE } from "@/i18n/routing";
import { captureServerEvent } from "@/lib/analytics/server";
import { BENCHMARK_SNAPSHOT_CREATED_EVENT, type NewSendPayload } from "@/lib/email/schema";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database, Json, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { raiseAlertFromTask } from "./ops-alert";
import { triggerRunUrl } from "./research-company";
import { sendEmailTask } from "./send-email";

type Service = SupabaseClient<Database>;
type CompanyRow = Tables<"companies">;

/** The ids every read and write is keyed by: from the loaded company row, never the payload alone. */
type CompanyIds = {
  readonly companyId: string;
  readonly organizationId: string;
};

/** The benchmark queue: five computations at a time across the project (AC-5). */
export const benchmarkQueue = queue({ name: "benchmark", concurrencyLimit: 5 });

export const benchmarkCompanyPayloadSchema = z.object({
  companyId: z.uuid(),
  triggerKind: z.enum(TRIGGER_KINDS),
  researchRunId: z.uuid().optional(),
});
export type BenchmarkCompanyPayload = z.infer<typeof benchmarkCompanyPayloadSchema>;

/**
 * The benchmark task (spec 0008, AC-5): loads the company by id with the service client (a
 * missing or archived company is skipped without a write), the active catalogue, the company's
 * current KPI rows, the peer rows for the KPI keys present and every assumption, re reads the
 * company right before computing, runs the pure model, validates the body with the version 1
 * schema and inserts one immutable `benchmark_snapshots` row. A snapshot is inserted even when
 * nothing compared or the cost is null, so the dashboard state is always decided by a row. Every
 * read and write filters by the loaded company's id and organization. The company's first
 * snapshot sends the benchmark ready email to every member (AC-7): the decision is taken from
 * the state *before* this insert, and a retry sends again so the email an attempt that died
 * after its insert owed is never lost. The global key `benchmark-ready/<companyId>/<userId>`
 * makes that repeat a no op, so the email is sent once and never lost. Throws on a database
 * error so Trigger.dev retries; `onFailure` raises the `benchmark.failed` alert once (AC-8).
 * Runs in the Trigger.dev EU environment.
 */
export const benchmarkCompanyTask = schemaTask({
  id: "benchmark-company",
  schema: benchmarkCompanyPayloadSchema,
  queue: benchmarkQueue,
  maxDuration: 120,
  retry: { maxAttempts: 3 },
  run: async (payload, { ctx }) => {
    const started = Date.now();
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const company = await loadCompany(supabase, payload.companyId);
    if (!company) {
      log.info("benchmark skipped: company missing or archived", {
        companyId: payload.companyId,
        triggerKind: payload.triggerKind,
      });
      return { status: "skipped" as const };
    }
    const ids: CompanyIds = { companyId: company.id, organizationId: company.organization_id };
    const step = (message: string, fields: Record<string, unknown> = {}) =>
      log.info(message, { ...ids, elapsedMs: Date.now() - started, ...fields });
    step("benchmark started", {
      triggerKind: payload.triggerKind,
      researchRunId: payload.researchRunId ?? null,
      attempt: ctx.attempt.number,
    });

    const [kpis, peerSearch] = await Promise.all([
      loadKpis(supabase, ids),
      loadPeers(supabase, ids, payload),
    ]);
    // The re read right before computing: its updated_at becomes inputs.companyUpdatedAt (AC-5).
    const fresh = (await loadCompany(supabase, ids.companyId, ids.organizationId)) ?? company;
    const body = computeBenchmark({
      company: {
        id: fresh.id,
        employeesCount: fresh.employees_count,
        industryCode: fresh.industry_code,
        country: fresh.country,
        currency: fresh.currency,
        updatedAt: fresh.updated_at,
      },
      kpis,
      peers: peerSearch.peers,
      thin: peerSearch.thin,
    });
    // Parse against the schema for the version this task writes, looked up rather than named, so a
    // later MODEL_VERSION bump cannot silently strip a block zod does not know about (AC-15).
    const writeSchema = SNAPSHOT_SCHEMAS[MODEL_VERSION];
    if (!writeSchema) throw new Error(`no snapshot schema for ${MODEL_VERSION}`);
    const blocks = writeSchema.parse({
      inputs: body.inputs,
      peers: body.peers,
      loss: body.loss,
      recommendation: body.recommendation,
    });
    step("benchmark computed", {
      kpiRows: kpis.length,
      peerRunId: peerSearch.researchRunId,
      peerRows: peerSearch.peers.length,
      rung: blocks.peers?.rung ?? null,
      thin: blocks.peers?.thin ?? null,
      ratesCompared: blocks.peers ? Object.keys(blocks.peers.rates) : [],
      currency: body.currency,
      lossAmount: body.lossAmount,
      savingAtMedian: body.savingAtMedian,
      recommendation: blocks.recommendation,
      confidence: body.confidence,
    });

    // Read before the insert: after it, a retry's own crashed row would look like a predecessor.
    const hadSnapshot = await hasSnapshot(supabase, ids);
    const { data: inserted, error } = await supabase
      .from("benchmark_snapshots")
      .insert({
        organization_id: ids.organizationId,
        company_id: ids.companyId,
        research_run_id:
          payload.triggerKind === "research" ? (payload.researchRunId ?? null) : null,
        trigger_kind: payload.triggerKind,
        model_version: MODEL_VERSION,
        // No curated row reaches `@7`, so nothing it stores can be provisional (AC-16).
        peer_provisional: false,
        kpis_compared: body.kpisCompared,
        confidence: body.confidence,
        currency: body.currency,
        loss_amount: body.lossAmount,
        saving_at_median: body.savingAtMedian,
        // The CHF named columns and the three block columns belong to `@1` to `@6` and stay null
        // from `@7` on (AC-16).
        cost_chf: null,
        cost_low_chf: null,
        cost_high_chf: null,
        saving_median_chf: null,
        saving_top_chf: null,
        results: null,
        gaps: null,
        assumptions: null,
        inputs: blocks.inputs as unknown as Json,
        peers: blocks.peers as unknown as Json,
        // `loss` rides in `cost` and `recommendation` in `derived`: AC-16 added no column for them
        // and these two are what the old model left free. `snapshot.ts` reads them back the same
        // way, and the two ends are the only places the mapping is spelled.
        cost: blocks.loss as unknown as Json,
        derived: blocks.recommendation as unknown as Json,
      })
      .select("id, created_at")
      .single();
    if (error) throw queryError(error);
    const first = !hadSnapshot;
    // A retry re sends what the crashed attempt owed; the global key makes a repeat a no op.
    const send = first || ctx.attempt.number > 1;
    step("benchmark snapshot stored", {
      snapshotId: inserted.id,
      createdAt: inserted.created_at,
      first,
      send,
    });
    if (send) {
      const sent = await sendBenchmarkReady(supabase, ids, company.name, body);
      step("benchmark ready emails queued", { members: sent.members, queued: sent.queued });
    }
    // After the snapshot insert (AC-8): this task retries up to three times, so firing before the
    // insert would emit a second event for one logical run when an attempt crashed mid run.
    // `kpisCompared` is the value written to the row, not `results.length`: the two can differ.
    // Snapshots are append only, so an attempt that died after its insert leaves a row behind and
    // the retry inserts its own: the insert cannot say whether this event was already emitted.
    // `ctx.run.id` can, because it is one id for every attempt of one logical run and a different
    // one for every legitimate recompute, which must still fire.
    await captureBenchmarkComputed(
      supabase,
      company,
      payload.triggerKind,
      body.kpisCompared,
      ctx.run.id,
    );
    return { status: "stored" as const, snapshotId: inserted.id, first };
  },
  onFailure: async ({ payload, error, ctx }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const { data: company } = await supabase
      .from("companies")
      .select("id, organization_id, name")
      .eq("id", payload.companyId)
      .maybeSingle();
    const ids: CompanyIds = {
      companyId: payload.companyId,
      organizationId: company?.organization_id ?? "",
    };
    reportBenchmarkError(error, ids, ctx.run.id);
    const errorMessage = errorMessageOf(error).slice(0, 500);
    log.error("benchmark failed after the last attempt", {
      ...ids,
      triggerKind: payload.triggerKind,
      triggerRunId: ctx.run.id,
      reason: errorMessage,
    });
    const { data: organization } = company
      ? await supabase
          .from("organizations")
          .select("name")
          .eq("id", company.organization_id)
          .maybeSingle()
      : { data: null };
    await raiseAlertFromTask({
      kind: "benchmark.failed",
      fields: {
        organizationName: organization?.name ?? "Unknown organization",
        companyName: company?.name ?? "Unknown company",
        triggerKind: payload.triggerKind as TriggerKind,
        errorMessage: errorMessage || "unknown error",
      },
      externalUrl: triggerRunUrl(ctx.project.ref, ctx.run.id),
      idempotencyKey: `benchmark-failed/${ctx.run.id}`,
    });
  },
});

/**
 * Fires `benchmark.computed` after the snapshot insert (spec 0017, AC-5, AC-8). The person is the
 * company's creator, taken from the row this task already loaded rather than from a second query;
 * the locale is that person's stored one, the same `localeForUser` the email rail uses. A company
 * whose `created_by` is null (a row created by the service role) is skipped rather than sent under
 * a placeholder id, because a fabricated person is worse in a funnel than a missing event. Never
 * throws: the snapshot is already stored and analytics may not fail a stored computation.
 *
 * Keyed by `benchmark-computed/<triggerRunId>` so one logical computation is one event however
 * many attempts it took (AC-8): every attempt of a run shares the id, and a legitimate recompute
 * is a different run, so it still fires.
 */
async function captureBenchmarkComputed(
  supabase: Service,
  company: CompanyRow,
  triggerKind: TriggerKind,
  kpisCompared: number,
  triggerRunId: string,
): Promise<void> {
  const createdBy = company.created_by;
  if (!createdBy) {
    log.info("benchmark.computed not captured: the company has no creator", {
      companyId: company.id,
    });
    return;
  }
  try {
    const locale = await localeForUser(supabase, createdBy);
    await captureServerEvent({
      distinctId: createdBy,
      event: "benchmark.computed",
      dedupeKey: `benchmark-computed/${triggerRunId}`,
      properties: {
        organizationId: company.organization_id,
        locale: LOCALE_CODE[locale],
        companyId: company.id,
        triggerKind,
        kpisCompared,
        modelVersion: MODEL_VERSION,
      },
    });
  } catch (error) {
    log.warn("benchmark.computed not captured", {
      companyId: company.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

/** How long the global key blocks a second benchmark ready email for the same member and company. */
const EMAIL_IDEMPOTENCY_TTL = "30d";

/**
 * Sends the benchmark ready email to every member of the company's organization (AC-7), one
 * `send-email` trigger per member with the recipient resolved by user id and the key
 * `benchmark-ready/<companyId>/<userId>`. Money goes in rounded. A failed trigger is logged and
 * never fails the task.
 */
async function sendBenchmarkReady(
  supabase: Service,
  ids: CompanyIds,
  companyName: string,
  body: SnapshotBody,
): Promise<{ readonly members: number; readonly queued: number }> {
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", ids.organizationId);
  if (error) throw queryError(error);
  // Rounded here, with the same function the card uses, so the two surfaces never show different
  // numbers for one snapshot (spec 0016, AC-13; spec 0022, AC-14, AC-17).
  const data: NewSendPayload["data"] = {
    companyName,
    currency: body.currency,
    peersCompared: body.peers?.rows.length ?? 0,
    ...(body.lossAmount === null ? {} : { lossAmount: roundMoney(body.lossAmount) }),
    ...(body.savingAtMedian === null ? {} : { savingAtMedian: roundMoney(body.savingAtMedian) }),
  };
  let queued = 0;
  for (const member of members) {
    const key = `benchmark-ready/${ids.companyId}/${member.user_id}`;
    try {
      const idempotencyKey = await idempotencyKeys.create(key, { scope: "global" });
      await sendEmailTask.trigger(
        {
          kind: "new",
          template: "benchmark_ready",
          data,
          recipient: { userId: member.user_id },
          sourceEvent: BENCHMARK_SNAPSHOT_CREATED_EVENT,
          organizationId: ids.organizationId,
          idempotencyKey: key,
        },
        { idempotencyKey, idempotencyKeyTTL: EMAIL_IDEMPOTENCY_TTL },
      );
      queued += 1;
    } catch (sendError) {
      log.error("benchmark ready email trigger failed", {
        ...ids,
        userId: member.user_id,
        reason: sendError instanceof Error ? sendError.message : String(sendError),
      });
    }
  }
  return { members: members.length, queued };
}

/** The company by id (and organization on the re read), skipping archived rows (AC-5). */
async function loadCompany(
  supabase: Service,
  companyId: string,
  organizationId?: string,
): Promise<CompanyRow | null> {
  let query = supabase.from("companies").select("*").eq("id", companyId).is("archived_at", null);
  if (organizationId) query = query.eq("organization_id", organizationId);
  const { data, error } = await query.maybeSingle();
  if (error) throw queryError(error);
  return data;
}

/** What the peers of one run come back as: the rows, the run they belong to and its thin flag. */
type PeerSearch = {
  readonly researchRunId: string | null;
  readonly peers: readonly ModelPeerRow[];
  readonly thin: boolean;
};

/**
 * The peers the snapshot compares against (AC-17): the rows of `researchRunId` when this run was
 * triggered by research, else the rows of the company's latest `succeeded` run that has any peer
 * row, and failing that the latest `succeeded` run, which then contributes none. The run's own
 * `summary.peers.thin` rides along, because whether a comparison is thin is a property of the
 * search, not of how many rows survived into this query.
 *
 * Nothing is read from `benchmarks`, `benchmark_assumptions`, `peer_companies` or `peer_figures`:
 * spec 0022 (AC-19) dropped all four.
 */
async function loadPeers(
  supabase: Service,
  ids: CompanyIds,
  payload: BenchmarkCompanyPayload,
): Promise<PeerSearch> {
  const runId =
    payload.triggerKind === "research" && payload.researchRunId
      ? payload.researchRunId
      : await latestRunWithPeers(supabase, ids);
  if (!runId) return { researchRunId: null, peers: [], thin: true };
  const [rows, thin] = await Promise.all([
    peerRowsOf(supabase, ids, runId),
    thinOf(supabase, ids, runId),
  ]);
  return { researchRunId: runId, peers: rows, thin };
}

/** The latest `succeeded` run holding a peer row, else the latest `succeeded` run at all (AC-17). */
async function latestRunWithPeers(supabase: Service, ids: CompanyIds): Promise<string | null> {
  const { data: runs, error } = await supabase
    .from("research_runs")
    .select("id")
    .eq("company_id", ids.companyId)
    .eq("organization_id", ids.organizationId)
    .eq("status", "succeeded")
    .order("finished_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw queryError(error);
  if (runs.length === 0) return null;
  const { data: withPeers, error: peerError } = await supabase
    .from("research_peers")
    .select("research_run_id")
    .eq("company_id", ids.companyId)
    .eq("organization_id", ids.organizationId)
    .in(
      "research_run_id",
      runs.map((run) => run.id),
    );
  if (peerError) throw queryError(peerError);
  const hasPeers = new Set(withPeers.map((row) => row.research_run_id));
  // `runs` is newest first, so the first match is the newest run that has peers (AC-17).
  return runs.find((run) => hasPeers.has(run.id))?.id ?? runs[0]?.id ?? null;
}

/** The run's `research_peers` rows as the model takes them (AC-17). */
async function peerRowsOf(
  supabase: Service,
  ids: CompanyIds,
  runId: string,
): Promise<readonly ModelPeerRow[]> {
  const { data, error } = await supabase
    .from("research_peers")
    .select(
      "peer_name, peer_country, headcount, kpi_key, period_year, value, source_url, confidence, rung",
    )
    .eq("company_id", ids.companyId)
    .eq("organization_id", ids.organizationId)
    .eq("research_run_id", runId);
  if (error) throw queryError(error);
  return data.flatMap((row) => {
    // The table's own check constrains both columns, but the generated types say `string`: a row
    // outside the two enums is dropped rather than cast into the model.
    if (!isKpiKey(row.kpi_key) || (row.kpi_key !== "ltifr" && row.kpi_key !== "trifr")) return [];
    if (!(PEER_RUNGS as readonly string[]).includes(row.rung)) return [];
    return [
      {
        peerName: row.peer_name,
        country: row.peer_country,
        headcount: row.headcount,
        kpiKey: row.kpi_key,
        periodYear: row.period_year,
        value: Number(row.value),
        sourceUrl: row.source_url,
        confidence: Number(row.confidence),
        rung: row.rung as PeerRung,
      },
    ];
  });
}

/** The run's own `summary.peers.thin`; true when the run recorded no peer search at all. */
async function thinOf(supabase: Service, ids: CompanyIds, runId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("research_runs")
    .select("summary")
    .eq("id", runId)
    .eq("organization_id", ids.organizationId)
    .maybeSingle();
  if (error) throw queryError(error);
  return parseSummary(data?.summary)?.peers?.thin ?? true;
}

/** The company's effective KPI rows (the view already picks client over research per year). */
async function loadKpis(supabase: Service, ids: CompanyIds): Promise<readonly ModelKpiRow[]> {
  const { data, error } = await supabase
    .from("company_kpi_current")
    .select("id, kpi_key, value, period_year, source, confidence, research_run_id")
    .eq("company_id", ids.companyId)
    .eq("organization_id", ids.organizationId);
  if (error) throw queryError(error);
  return data.flatMap((row) => {
    if (
      row.id === null ||
      row.value === null ||
      row.period_year === null ||
      !isKpiKey(row.kpi_key) ||
      (row.source !== "research" && row.source !== "client")
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        kpiKey: row.kpi_key,
        value: Number(row.value),
        periodYear: row.period_year,
        source: row.source,
        confidence: row.confidence === null ? null : Number(row.confidence),
        researchRunId: row.research_run_id,
      },
    ];
  });
}

/**
 * True when the company already has a snapshot (AC-5). Read *before* the insert, so the answer is
 * the state this attempt found: an attempt that dies after its insert leaves a row behind, and
 * the retry then pairs a `false` here with its attempt number to still send the owed email.
 */
async function hasSnapshot(supabase: Service, ids: CompanyIds): Promise<boolean> {
  const { data, error } = await supabase
    .from("benchmark_snapshots")
    .select("id")
    .eq("company_id", ids.companyId)
    .eq("organization_id", ids.organizationId)
    .limit(1)
    .maybeSingle();
  if (error) throw queryError(error);
  return data !== null;
}

/** Reports a task error to Sentry with the company ids (AC-8). */
export function reportBenchmarkError(error: unknown, ids: CompanyIds, triggerRunId: string): void {
  Sentry.captureException(error, {
    tags: { company_id: ids.companyId, source: "benchmark-company" },
    extra: { ...ids, triggerRunId },
  });
}

/**
 * The message of a failed run for the log and the alert (AC-8): an `Error`'s, the `message` of a
 * plain object (what supabase-js hands back for a failed query, and what a serialized error
 * becomes), else the string form. Pure.
 */
export function errorMessageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const { message } = error;
    if (typeof message === "string") return message;
  }
  return String(error ?? "");
}
