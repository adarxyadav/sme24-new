"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { KPI_KEYS, type KpiKey } from "@/features/research/catalogue";
import { type Locale, resolveLocale } from "@/i18n/routing";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { parseWith } from "@/lib/validation";
import type { benchmarkCompanyTask } from "@/trigger/benchmark-company";
import { clearClientKpiSchema, clientKpisFormSchema } from "./schema";
import { currentYear } from "./years";

type Client = SupabaseClient<Database>;

/**
 * The self assessment server actions (spec 0010, AC-5, AC-6): `saveClientKpis` writes the figures
 * a client typed for one year as `company_kpis` rows with `source 'client'`, `clearClientKpi`
 * deletes one of them; both queue the existing `benchmark-company` task under a `client_edit`
 * trigger. Authorization lives here (the client role with an organization claim, the company
 * ownership check), not only in the proxy; the policies are the real boundary.
 */

export type SelfAssessmentActionError =
  | "validation"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unexpected";

export type SelfAssessmentActionResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; error: SelfAssessmentActionError };

export type SaveClientKpisData = {
  companyId: string;
  periodYear: number;
  saved: KpiKey[];
  benchmarkQueued: boolean;
};

export type ClearClientKpiData = {
  companyId: string;
  kpiKey: KpiKey;
  periodYear: number;
  benchmarkQueued: boolean;
};

/** Saves inside the same write moment collapse to one computation that reads every stored row (AC-5). */
const KPIS_IDEMPOTENCY_TTL = "1h";

/** Postgres unique violation: a second tab inserted the same KPI and year in between (AC-5). */
const UNIQUE_VIOLATION = "23505";

type Actor = {
  readonly supabase: Client;
  readonly organizationId: string;
  readonly userId: string;
};

/** A signed in client with an organization claim; anything else is `forbidden`. */
async function requireClient(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const organizationId = organizationIdFromClaims(claims);
  if (roleFromClaims(claims) !== "client" || typeof claims?.sub !== "string" || !organizationId) {
    return null;
  }
  return { supabase, organizationId, userId: claims.sub };
}

function localeOf(input: unknown): Locale {
  return resolveLocale((input as { locale?: unknown } | null)?.locale);
}

/**
 * Saves the figures of one reporting year (AC-5): parses with the form schema, confirms the
 * company belongs to the organization and is not archived, then, because the client unique index
 * is partial and PostgREST cannot upsert onto it, reads the existing client rows for the sent
 * keys, updates each by id (zero rows means another member created it: `forbidden`, and the
 * insert never runs) and inserts the rest in one statement (`23505` is `conflict`). Every row the
 * writes return carries `updated_at`; the newest keys the benchmark trigger. A trigger failure
 * still answers `ok` with `benchmarkQueued` false. Server action, client member.
 */
export async function saveClientKpis(
  _previous: SelfAssessmentActionResult<SaveClientKpisData> | null,
  input: unknown,
): Promise<SelfAssessmentActionResult<SaveClientKpisData>> {
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(clientKpisFormSchema(currentYear(new Date())), input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, organizationId, userId } = actor;
  const { companyId, periodYear, values } = parsed.data;
  const sent = KPI_KEYS.flatMap((key) => {
    const value = values[key];
    return value === undefined ? [] : [{ key, value }];
  });

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id")
    .eq("id", companyId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .maybeSingle();
  if (companyError) return unexpected("save-client-kpis", companyError, organizationId);
  if (!company) return { ok: false, error: "not_found" };

  const { data: existing, error: existingError } = await supabase
    .from("company_kpis")
    .select("id, kpi_key")
    .eq("company_id", companyId)
    .eq("period_year", periodYear)
    .eq("source", "client")
    .in(
      "kpi_key",
      sent.map((entry) => entry.key),
    );
  if (existingError) return unexpected("save-client-kpis", existingError, organizationId);
  const existingByKey = new Map(existing.map((row) => [row.kpi_key, row.id]));

  const moments: string[] = [];
  for (const entry of sent) {
    const id = existingByKey.get(entry.key);
    if (!id) continue;
    const { data, error } = await supabase
      .from("company_kpis")
      .update({ value: entry.value })
      .eq("id", id)
      .select("id, updated_at");
    if (error) return unexpected("save-client-kpis", error, organizationId);
    const updated = data[0];
    // The row exists but the members update policy filtered it: another member created it.
    if (!updated) return { ok: false, error: "forbidden" };
    moments.push(updated.updated_at);
  }

  const inserts: Database["public"]["Tables"]["company_kpis"]["Insert"][] = sent
    .filter((entry) => !existingByKey.has(entry.key))
    .map((entry) => ({
      organization_id: organizationId,
      company_id: companyId,
      kpi_key: entry.key,
      period_year: periodYear,
      value: entry.value,
      source: "client",
      created_by: userId,
      confidence: null,
      sources: [],
      research_run_id: null,
      note: null,
    }));
  if (inserts.length > 0) {
    const { data, error } = await supabase
      .from("company_kpis")
      .insert(inserts)
      .select("id, updated_at");
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { ok: false, error: "conflict" };
      return unexpected("save-client-kpis", error, organizationId);
    }
    moments.push(...data.map((row) => row.updated_at));
  }

  const moment = moments.reduce((newest, value) => (value > newest ? value : newest), "");
  const saved = sent.map((entry) => entry.key);
  const benchmarkQueued = await triggerBenchmark(
    `benchmark/kpis/${companyId}/${moment}`,
    companyId,
    organizationId,
    "save-client-kpis",
  );
  log.info("client kpis saved", {
    organizationId,
    companyId,
    periodYear,
    keys: saved,
    benchmarkQueued,
  });
  return { ok: true, data: { companyId, periodYear, saved, benchmarkQueued } };
}

/**
 * Clears one figure (AC-6): deletes the client row for the company, KPI and year through the
 * members delete policy (zero rows is `not_found`) and queues the benchmark under the deleted
 * row's id. The view then shows the research row for that year again by itself. Server action,
 * client member.
 */
export async function clearClientKpi(
  _previous: SelfAssessmentActionResult<ClearClientKpiData> | null,
  input: unknown,
): Promise<SelfAssessmentActionResult<ClearClientKpiData>> {
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(clearClientKpiSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, organizationId } = actor;
  const { companyId, kpiKey, periodYear } = parsed.data;

  const { data, error } = await supabase
    .from("company_kpis")
    .delete()
    .eq("company_id", companyId)
    .eq("kpi_key", kpiKey)
    .eq("period_year", periodYear)
    .eq("source", "client")
    .select("id");
  if (error) return unexpected("clear-client-kpi", error, organizationId);
  const deleted = data[0];
  if (!deleted) return { ok: false, error: "not_found" };

  const benchmarkQueued = await triggerBenchmark(
    `benchmark/kpis-clear/${deleted.id}`,
    companyId,
    organizationId,
    "clear-client-kpi",
  );
  log.info("client kpi cleared", {
    organizationId,
    companyId,
    periodYear,
    kpiKey,
    benchmarkQueued,
  });
  return { ok: true, data: { companyId, kpiKey, periodYear, benchmarkQueued } };
}

/** Queues the recomputation under the given key (AC-5, AC-6); false when the key is unset or the trigger failed. */
async function triggerBenchmark(
  key: string,
  companyId: string,
  organizationId: string,
  source: string,
): Promise<boolean> {
  if (!serverEnv().TRIGGER_SECRET_KEY) {
    log.warn("benchmark not queued after a client kpi write: TRIGGER_SECRET_KEY is not set", {
      organizationId,
      companyId,
      source,
    });
    return false;
  }
  try {
    const idempotencyKey = await idempotencyKeys.create(key, { scope: "global" });
    await tasks.trigger<typeof benchmarkCompanyTask>(
      "benchmark-company",
      { companyId, triggerKind: "client_edit" },
      { idempotencyKey, idempotencyKeyTTL: KPIS_IDEMPOTENCY_TTL },
    );
    return true;
  } catch (error) {
    log.error("benchmark trigger failed after a client kpi write", {
      organizationId,
      companyId,
      source,
      reason: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, { tags: { source }, extra: { organizationId, companyId } });
    return false;
  }
}

function unexpected(
  action: string,
  error: { message: string; code?: string },
  organizationId: string,
): { ok: false; error: "unexpected" } {
  log.error(`${action} failed`, { organizationId, code: error.code, reason: error.message });
  Sentry.captureException(error, { tags: { source: action }, extra: { organizationId } });
  return { ok: false, error: "unexpected" };
}
