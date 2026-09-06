import "./instrumentation";

import * as Sentry from "@sentry/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotencyKeys, queue, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";
import { MODEL_VERSION, TRIGGER_KINDS, type TriggerKind } from "@/features/benchmark/catalogue";
import {
  computeBenchmark,
  type ModelAssumption,
  type ModelCatalogueEntry,
  type ModelKpiRow,
  type ModelPeerRow,
  roundChf,
} from "@/features/benchmark/model";
import { type SnapshotBody, snapshotBlocksV1Schema } from "@/features/benchmark/snapshot";
import { isKpiKey } from "@/features/research/catalogue";
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
 * snapshot sends the benchmark ready email to every member (AC-7). Throws on a database error so
 * Trigger.dev retries; `onFailure` raises the `benchmark.failed` alert once (AC-8). Runs in the
 * Trigger.dev EU environment.
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

    const [catalogue, kpis, assumptions] = await Promise.all([
      loadCatalogue(supabase),
      loadKpis(supabase, ids),
      loadAssumptions(supabase),
    ]);
    const peers = await loadPeers(supabase, [...new Set(kpis.map((row) => row.kpiKey))]);
    // The re read right before computing: its updated_at becomes inputs.companyUpdatedAt (AC-5).
    const fresh = (await loadCompany(supabase, ids.companyId, ids.organizationId)) ?? company;
    const body = computeBenchmark({
      company: {
        id: fresh.id,
        employeesCount: fresh.employees_count,
        industryCode: fresh.industry_code,
        updatedAt: fresh.updated_at,
      },
      catalogue,
      kpis,
      peers,
      assumptions,
    });
    const blocks = snapshotBlocksV1Schema.parse({
      inputs: body.inputs,
      results: body.results,
      gaps: body.gaps,
      cost: body.cost,
      assumptions: body.assumptions,
    });
    for (const result of blocks.results) {
      step("benchmark peer selected", {
        kpi: result.key,
        rung: result.peer?.rung ?? null,
        section: result.peer?.industrySection ?? null,
        band: result.peer?.sizeBand ?? null,
        year: result.peer?.periodYear ?? null,
        yearMatch: result.peer?.yearMatch ?? null,
        position: result.position,
      });
    }
    step("benchmark computed", {
      kpiRows: kpis.length,
      peerRows: peers.length,
      kpisCompared: body.kpisCompared,
      gaps: blocks.gaps.length,
      costChf: body.costChf,
      confidence: body.confidence,
      peerProvisional: body.peerProvisional,
    });

    const { data: inserted, error } = await supabase
      .from("benchmark_snapshots")
      .insert({
        organization_id: ids.organizationId,
        company_id: ids.companyId,
        research_run_id:
          payload.triggerKind === "research" ? (payload.researchRunId ?? null) : null,
        trigger_kind: payload.triggerKind,
        model_version: MODEL_VERSION,
        peer_provisional: body.peerProvisional,
        kpis_compared: body.kpisCompared,
        confidence: body.confidence,
        cost_chf: body.costChf,
        cost_low_chf: body.costLowChf,
        cost_high_chf: body.costHighChf,
        saving_median_chf: body.savingMedianChf,
        saving_top_chf: body.savingTopChf,
        inputs: blocks.inputs as unknown as Json,
        results: blocks.results as unknown as Json,
        gaps: blocks.gaps as unknown as Json,
        cost: blocks.cost as unknown as Json,
        assumptions: blocks.assumptions as unknown as Json,
      })
      .select("id, created_at")
      .single();
    if (error) throw queryError(error);
    const first = await isFirstSnapshot(supabase, ids, inserted.id);
    step("benchmark snapshot stored", {
      snapshotId: inserted.id,
      createdAt: inserted.created_at,
      first,
    });
    if (first) {
      const sent = await sendBenchmarkReady(supabase, ids, company.name, body);
      step("benchmark ready emails queued", { members: sent.members, queued: sent.queued });
    }
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
  const data: NewSendPayload["data"] = {
    companyName,
    kpisCompared: body.kpisCompared,
    ...(body.costChf === null ? {} : { costChf: roundChf(body.costChf) }),
    ...(body.savingMedianChf === null ? {} : { savingMedianChf: roundChf(body.savingMedianChf) }),
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

async function loadCatalogue(supabase: Service): Promise<readonly ModelCatalogueEntry[]> {
  const { data, error } = await supabase
    .from("kpi_definitions")
    .select("key, direction, sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw queryError(error);
  return data.flatMap((row) =>
    isKpiKey(row.key)
      ? [
          {
            key: row.key,
            direction: row.direction as ModelCatalogueEntry["direction"],
            sortOrder: row.sort_order,
          },
        ]
      : [],
  );
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

async function loadPeers(
  supabase: Service,
  keys: readonly string[],
): Promise<readonly ModelPeerRow[]> {
  if (keys.length === 0) return [];
  const { data, error } = await supabase
    .from("benchmarks")
    .select("*")
    .in("kpi_key", [...keys]);
  if (error) throw queryError(error);
  return data.flatMap((row) =>
    isKpiKey(row.kpi_key)
      ? [
          {
            id: row.id,
            kpiKey: row.kpi_key,
            industrySection: row.industry_section,
            sizeBand: row.size_band as ModelPeerRow["sizeBand"],
            periodYear: row.period_year,
            p25: Number(row.p25),
            median: Number(row.median),
            p75: Number(row.p75),
            sampleSize: row.sample_size,
            provisional: row.provisional,
          },
        ]
      : [],
  );
}

async function loadAssumptions(supabase: Service): Promise<readonly ModelAssumption[]> {
  const { data, error } = await supabase.from("benchmark_assumptions").select("*");
  if (error) throw queryError(error);
  return data.map((row) => ({
    key: row.key as ModelAssumption["key"],
    value: Number(row.value),
    unit: row.unit,
    sourceName: row.source_name,
    sourceUrl: row.source_url,
    provisional: row.provisional,
    effectiveFrom: row.effective_from,
  }));
}

/**
 * True when the inserted row is the company's oldest snapshot (AC-5): a retry that inserts a
 * second row is not first, so the benchmark ready email is sent once and never lost.
 */
async function isFirstSnapshot(
  supabase: Service,
  ids: CompanyIds,
  snapshotId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("benchmark_snapshots")
    .select("id")
    .eq("company_id", ids.companyId)
    .eq("organization_id", ids.organizationId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw queryError(error);
  return data?.id === snapshotId;
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
