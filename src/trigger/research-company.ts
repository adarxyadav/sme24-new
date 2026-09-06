import "./instrumentation";

import * as Sentry from "@sentry/node";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AbortTaskRunError,
  idempotencyKeys,
  queue,
  schemaTask,
  tasks,
  wait,
} from "@trigger.dev/sdk";
import { z } from "zod";
import { KPI_KEYS, type KpiKey, type RUN_STEPS } from "@/features/research/catalogue";
import { websiteHost } from "@/features/research/schema";
import {
  type CompanyFacts,
  type DroppedValue,
  parseSummary,
  type ResearchSummary,
} from "@/features/research/summary";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { collectSources, extractCandidates, extractFactFields } from "@/lib/research/candidates";
import { createFixtureProvider } from "@/lib/research/fixture";
import { buildOutputSchema } from "@/lib/research/output-schema";
import { createParallelProvider } from "@/lib/research/parallel";
import {
  ProviderRejectedError,
  ProviderUnavailableError,
  type ResearchProvider,
} from "@/lib/research/provider";
import { type KeptValue, resolveValues } from "@/lib/research/resolve";
import { validateResearch } from "@/lib/research/validate";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import type { benchmarkCompanyTask } from "./benchmark-company";
import { raiseAlertFromTask } from "./ops-alert";

type Service = SupabaseClient<Database>;
type RunRow = Tables<"research_runs">;
type CompanyRow = Tables<"companies">;

/** The ids every read and write is keyed by: taken from the loaded run row, never from the payload (AC-14). */
type RunIds = {
  readonly runId: string;
  readonly organizationId: string;
  readonly companyId: string;
};

/** The error codes the client sees (`research.errors.<code>` in the catalogs). */
export const RESEARCH_ERROR_CODES = [
  "provider_rejected",
  "provider_unavailable",
  "provider_timeout",
  "internal",
  "stale",
  "trigger_failed",
] as const;
export type ResearchErrorCode = (typeof RESEARCH_ERROR_CODES)[number];

/** Seconds between two provider status checks (AC-4). */
const POLL_SECONDS = 15;
/** The wall clock budget of a run from `started_at`, across attempts (AC-4). */
const BUDGET_MS = 20 * 60 * 1000;
/** Postgres: unique violation. */
const UNIQUE_VIOLATION = "23505";

/** The research queue: five runs at a time across the project (AC-4). */
export const researchQueue = queue({ name: "research", concurrencyLimit: 5 });

export const researchCompanyPayloadSchema = z.object({ runId: z.uuid() });

/**
 * The research task (spec 0007, AC-4 to AC-6, AC-10, AC-13, AC-15): loads the run with the
 * service client, then keys every read and write by that row's ids. A `queued` run moves to
 * `running`; the provider run is created (or resumed from `provider_run_id` on a retry) and
 * polled every 15 seconds inside a 20 minute wall clock budget; the result becomes candidates,
 * the validator checks them (slice 3), the kept values become `company_kpis` rows and the run
 * ends `succeeded` or `empty` through a guarded terminal write. Transient provider errors throw
 * so Trigger.dev retries; a 4xx or the budget aborts. `onFailure` records the error code and
 * raises the `research.run_failed` alert once. Runs in the Trigger.dev EU environment.
 */
export const researchCompanyTask = schemaTask({
  id: "research-company",
  schema: researchCompanyPayloadSchema,
  queue: researchQueue,
  maxDuration: 900,
  retry: { maxAttempts: 3 },
  run: async (payload, { ctx }) => {
    const startedAttempt = Date.now();
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const run = await loadRun(supabase, payload.runId);
    const ids: RunIds = {
      runId: run.id,
      organizationId: run.organization_id,
      companyId: run.company_id,
    };
    const step = (message: string, fields: Record<string, unknown> = {}) =>
      log.info(message, { ...ids, elapsedMs: Date.now() - startedAttempt, ...fields });

    if (run.status !== "queued" && run.status !== "running") {
      step("research run already finished, nothing to do", { status: run.status });
      return { status: run.status };
    }

    const startedAt = run.status === "queued" ? await markRunning(supabase, ids) : run.started_at;
    const startedAtMs = startedAt ? Date.parse(startedAt) : Date.now();
    const overBudget = () => Date.now() - startedAtMs > BUDGET_MS;
    if (overBudget()) {
      throw new AbortTaskRunError("provider_timeout: the run started more than 20 minutes ago");
    }

    const company = await loadCompany(supabase, ids);
    const fixture = env.RESEARCH_PROVIDER === "fixture";
    const provider: ResearchProvider = fixture
      ? createFixtureProvider()
      : createParallelProvider(env.PARALLEL_API_KEY ?? "");
    step("research attempt started", {
      attempt: ctx.attempt.number,
      provider: env.RESEARCH_PROVIDER,
      providerRunId: run.provider_run_id,
    });

    // The provider run is created once and its id stored before the first poll, so a retry
    // resumes it instead of paying for a second one (key invariant).
    let providerRunId = run.provider_run_id;
    if (!providerRunId) {
      const created = await classifyProviderCall(() =>
        provider.createRun(
          {
            name: company.name,
            legalName: company.legal_name,
            website: company.website,
            country: company.country,
          },
          buildOutputSchema(),
        ),
      );
      providerRunId = created.providerRunId;
      await patchRun(supabase, ids, { provider_run_id: providerRunId });
      step("provider run created", { providerRunId });
    }

    const searchStarted = Date.now();
    for (;;) {
      const { status } = await classifyProviderCall(() => provider.getRun(providerRunId as string));
      if (status === "done") break;
      if (status === "failed") {
        throw new AbortTaskRunError("provider_rejected: the provider reported the run as failed");
      }
      if (overBudget()) {
        throw new AbortTaskRunError("provider_timeout: no result within 20 minutes");
      }
      if (!fixture) await wait.for({ seconds: POLL_SECONDS });
    }
    const result = await classifyProviderCall(() => provider.getResult(providerRunId as string));
    const searchMs = Date.now() - searchStarted;
    const retrievedAt = new Date().toISOString();
    const sources = collectSources(result, retrievedAt);
    step("provider result received", {
      providerRunId,
      sourcesFound: sources.length,
      processor: result.processor,
      searchMs,
    });

    await patchSummary(supabase, ids, {
      step: "extracting",
      processor: result.processor,
      sourcesFound: sources.length,
    });
    const candidates = extractCandidates(result, retrievedAt);
    const validationStarted = Date.now();
    const validation = await validateResearch({
      company: {
        name: company.name,
        legalName: company.legal_name,
        website: company.website,
        country: company.country,
      },
      candidates,
      facts: extractFactFields(result),
      apiKey: env.AI_GATEWAY_API_KEY,
      onError: (error) => reportToSentry(error, ids, ctx.run.id),
    });
    const validationMs = Date.now() - validationStarted;
    const currentYear = new Date().getUTCFullYear();
    const { kept, dropped } = resolveValues({
      candidates,
      verdicts: validation?.verdicts ?? null,
      companyHost: websiteHost(company.website),
      currentYear,
    });
    step("values resolved", {
      providerRunId,
      candidates: candidates.length,
      kept: kept.length,
      dropped: dropped.length,
      validation: validation ? "passed" : "skipped",
      validationMs,
    });

    await patchSummary(supabase, ids, { step: "saving", kpisExtracted: kept.length });
    await insertKpis(supabase, ids, kept);
    if (validation?.facts) await fillCompanyFacts(supabase, ids, validation.facts);
    const stored = await countRunKpis(supabase, ids);
    const status = stored > 0 ? "succeeded" : "empty";

    const summary: ResearchSummary = {
      version: 1,
      step: "done",
      processor: result.processor,
      sourcesFound: sources.length,
      kpisExtracted: stored,
      coverage: coverageOf(kept),
      years: [...new Set(kept.map((value) => value.periodYear))].sort((a, b) => b - a),
      sources: [...sources],
      text: result.text ? result.text.slice(0, 1000) : null,
      companyFacts: validation?.facts ?? {},
      dropped: [...dropped],
      validation: validation ? "passed" : "skipped",
      promptVersion: validation?.promptVersion ?? "",
      durations: { searchMs, validationMs, totalMs: Date.now() - startedAtMs },
    };
    const finished = await patchRun(
      supabase,
      ids,
      { status, finished_at: new Date().toISOString(), summary },
      "running",
    );
    if (finished === 0) {
      step("terminal write skipped: the run was closed by another writer", {
        providerRunId,
        intended: status,
      });
      return { status: "closed_elsewhere" };
    }
    step("research run finished", {
      providerRunId,
      status,
      stored,
      totalMs: summary.durations?.totalMs,
    });
    if (status === "succeeded") await triggerBenchmark(ids, ctx.run.id);
    return { status };
  },
  onFailure: async ({ payload, error, ctx }) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const { data: run } = await supabase
      .from("research_runs")
      .select("id, organization_id, company_id, status")
      .eq("id", payload.runId)
      .maybeSingle();
    if (!run) return;
    const ids: RunIds = {
      runId: run.id,
      organizationId: run.organization_id,
      companyId: run.company_id,
    };
    const code = errorCodeOf(error);
    const closed = await patchRun(
      supabase,
      ids,
      {
        status: "failed",
        error_code: code,
        error_message: SAFE_MESSAGES[code],
        finished_at: new Date().toISOString(),
      },
      ["queued", "running"],
    );
    reportToSentry(error, ids, ctx.run.id);
    if (closed === 0) {
      log.warn("research run failed after another writer closed it; no alert", { ...ids, code });
      return;
    }
    log.error("research run failed after the last attempt", {
      ...ids,
      code,
      triggerRunId: ctx.run.id,
    });
    const { data: organization } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", ids.organizationId)
      .maybeSingle();
    await raiseAlertFromTask({
      kind: "research.run_failed",
      fields: {
        runId: ids.runId,
        organizationName: organization?.name ?? "Unknown organization",
        reason: `${code}: ${SAFE_MESSAGES[code]}`,
      },
      externalUrl: triggerRunUrl(ctx.project.ref, ctx.run.id),
      idempotencyKey: `research-failed/${ids.runId}`,
    });
  },
});

/**
 * Queues the benchmark computation once the run ended `succeeded` (spec 0008, AC-6): the key
 * `benchmark/run/<runId>` makes a retried terminal write a no op. A trigger failure is logged and
 * reported and never changes the run's status.
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
    log.info("benchmark queued after the research run", { ...ids, benchmarkRunId: handle.id });
  } catch (error) {
    log.error("benchmark trigger failed after the research run", {
      ...ids,
      reason: error instanceof Error ? error.message : String(error),
    });
    reportToSentry(error, ids, triggerRunId);
  }
}

/** Short safe sentences per error code, stored on the row (AC-10); the catalogs carry the client wording. */
const SAFE_MESSAGES: Record<ResearchErrorCode, string> = {
  provider_rejected: "The research provider rejected the request.",
  provider_unavailable: "The research provider was unavailable.",
  provider_timeout: "The research did not finish within 20 minutes.",
  internal: "The research task failed unexpectedly.",
  stale: "The run was stuck and was closed by the sweep.",
  trigger_failed: "The research could not be started.",
};

/** The Trigger.dev run page ops open from the alert (AC-10). Pure. */
export function triggerRunUrl(projectRef: string, runId: string): string {
  return `https://cloud.trigger.dev/projects/v3/${projectRef}/runs/${runId}`;
}

/**
 * The error code of a failed run (AC-10): the prefix of an abort message, `provider_unavailable`
 * for the transient class after the last retry, `internal` for everything else (a `maxDuration`
 * kill lands here). Pure.
 */
export function errorCodeOf(error: unknown): ResearchErrorCode {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const prefix = message.match(/^(provider_rejected|provider_unavailable|provider_timeout)\b/);
  if (prefix?.[1]) return prefix[1] as ResearchErrorCode;
  if (error instanceof ProviderUnavailableError) return "provider_unavailable";
  if (error instanceof ProviderRejectedError) return "provider_rejected";
  return "internal";
}

/** Maps provider errors to the retry classes (AC-10): rejected aborts, unavailable throws for a retry. */
async function classifyProviderCall<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof ProviderRejectedError) {
      throw new AbortTaskRunError(`provider_rejected: ${error.message}`);
    }
    if (error instanceof ProviderUnavailableError) {
      throw new ProviderUnavailableError(`provider_unavailable: ${error.message}`, error.status);
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

/** `queued` → `running` with `started_at` and the first summary; returns the start time. */
async function markRunning(supabase: Service, ids: RunIds): Promise<string> {
  const startedAt = new Date().toISOString();
  const summary: ResearchSummary = { version: 1, step: "searching" };
  const rows = await patchRun(
    supabase,
    ids,
    { status: "running", started_at: startedAt, summary },
    "queued",
  );
  if (rows === 0) {
    // Another attempt moved it first (a crash between the write and the ack): carry on from its clock.
    const run = await loadRun(supabase, ids.runId);
    if (run.status !== "running") {
      throw new AbortTaskRunError(`internal: run is ${run.status}, cannot start`);
    }
    return run.started_at ?? startedAt;
  }
  return startedAt;
}

/**
 * Updates the run keyed by its ids, optionally guarded by the current status (the terminal
 * writes, AC-6, AC-10); returns the number of rows touched.
 */
async function patchRun(
  supabase: Service,
  ids: RunIds,
  patch: Database["public"]["Tables"]["research_runs"]["Update"],
  guard?: RunRow["status"] | readonly RunRow["status"][],
): Promise<number> {
  let query = supabase
    .from("research_runs")
    .update(patch)
    .eq("id", ids.runId)
    .eq("organization_id", ids.organizationId)
    .eq("company_id", ids.companyId);
  if (typeof guard === "string") query = query.eq("status", guard);
  else if (guard) query = query.in("status", [...guard]);
  const { data, error } = await query.select("id");
  if (error) throw queryError(error);
  return data.length;
}

/** Merges progress fields into the stored summary (AC-4, AC-7); never touches `status`. */
async function patchSummary(
  supabase: Service,
  ids: RunIds,
  patch: Partial<ResearchSummary> & { step: (typeof RUN_STEPS)[number] },
): Promise<void> {
  const { data, error } = await supabase
    .from("research_runs")
    .select("summary")
    .eq("id", ids.runId)
    .eq("organization_id", ids.organizationId)
    .maybeSingle();
  if (error) throw queryError(error);
  const current = parseSummary(data?.summary) ?? {
    version: 1 as const,
    step: "searching" as const,
  };
  await patchRun(supabase, ids, { summary: { ...current, ...patch } });
}

/**
 * Inserts one `company_kpis` row per kept value (AC-6). PostgREST cannot name the partial unique
 * index for `on conflict do nothing`, so the rows already stored by an earlier attempt are
 * skipped up front. A unique violation on the remainder means another attempt stored some of them
 * in between, so the stored set is re-read and only what is still missing is retried row by row.
 */
async function insertKpis(
  supabase: Service,
  ids: RunIds,
  kept: readonly KeptValue[],
): Promise<void> {
  if (kept.length === 0) return;
  const stored = await storedKpiSlots(supabase, ids);
  const rows = kept
    .filter((value) => !stored.has(`${value.key}:${value.periodYear}`))
    .map((value) => ({
      organization_id: ids.organizationId,
      company_id: ids.companyId,
      research_run_id: ids.runId,
      kpi_key: value.key,
      period_year: value.periodYear,
      value: value.value,
      source: "research",
      confidence: value.confidence,
      created_by: null,
      sources:
        value.sources as unknown as Database["public"]["Tables"]["company_kpis"]["Insert"]["sources"],
    }));
  if (rows.length === 0) return;
  const { error } = await supabase.from("company_kpis").insert(rows);
  if (!error) return;
  if (error.code !== UNIQUE_VIOLATION) throw queryError(error);

  const nowStored = await storedKpiSlots(supabase, ids);
  for (const row of rows) {
    if (nowStored.has(`${row.kpi_key}:${row.period_year}`)) continue;
    const { error: rowError } = await supabase.from("company_kpis").insert(row);
    if (rowError && rowError.code !== UNIQUE_VIOLATION) throw queryError(rowError);
  }
}

/** The `kpi:year` slots of the run already stored in `company_kpis` (AC-6, AC-14 ids). */
async function storedKpiSlots(supabase: Service, ids: RunIds): Promise<ReadonlySet<string>> {
  const { data, error } = await supabase
    .from("company_kpis")
    .select("kpi_key, period_year")
    .eq("research_run_id", ids.runId)
    .eq("company_id", ids.companyId);
  if (error) throw queryError(error);
  return new Set((data ?? []).map((row) => `${row.kpi_key}:${row.period_year}`));
}

/** The number of `company_kpis` rows of the run after the insert: the `succeeded` versus `empty` rule (AC-6). */
async function countRunKpis(supabase: Service, ids: RunIds): Promise<number> {
  const { count, error } = await supabase
    .from("company_kpis")
    .select("id", { count: "exact", head: true })
    .eq("research_run_id", ids.runId)
    .eq("company_id", ids.companyId);
  if (error) throw queryError(error);
  return count ?? 0;
}

/**
 * Fills the company facts where the column is still null (AC-6): one guarded update per fact
 * (`set legal_name = $1 where id = $companyId and legal_name is null`), which is what
 * `coalesce(legal_name, $1)` means row by row, so a client edit in flight is never overwritten.
 * PostgREST has no expression update, hence one statement per column.
 */
async function fillCompanyFacts(
  supabase: Service,
  ids: RunIds,
  facts: CompanyFacts,
): Promise<void> {
  type CompanyPatch = Database["public"]["Tables"]["companies"]["Update"];
  const updates: ReadonlyArray<readonly [column: keyof CompanyRow, patch: CompanyPatch]> = [
    ["legal_name", { legal_name: facts.legalName }],
    ["uid", { uid: facts.uid }],
    ["industry_code", { industry_code: facts.industryCode }],
    ["employees_count", { employees_count: facts.employeesCount }],
    ["canton", { canton: facts.canton }],
  ];
  for (const [column, patch] of updates) {
    if (Object.values(patch)[0] === undefined) continue;
    const { error } = await supabase
      .from("companies")
      .update(patch)
      .eq("id", ids.companyId)
      .eq("organization_id", ids.organizationId)
      .is(column, null);
    if (error) throw queryError(error);
  }
}

/** `found` or `not_found` per catalogue key (AC-6). Pure. */
function coverageOf(kept: readonly KeptValue[]): Record<KpiKey, "found" | "not_found"> {
  const found = new Set(kept.map((value) => value.key));
  return Object.fromEntries(
    KPI_KEYS.map((key) => [key, found.has(key) ? "found" : "not_found"]),
  ) as Record<KpiKey, "found" | "not_found">;
}

function reportToSentry(error: unknown, ids: RunIds, triggerRunId: string): void {
  Sentry.captureException(error, {
    tags: { research_run_id: ids.runId, source: "research-company" },
    extra: { ...ids, triggerRunId },
  });
}

export type { DroppedValue };
