"use server";

import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { type Locale, resolveLocale } from "@/i18n/routing";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import type { Database } from "@/lib/supabase/database.types";
import { parseWith } from "@/lib/validation";
import type { benchmarkCompanyTask } from "@/trigger/benchmark-company";
import { companyFactsFormSchema } from "./schema";

type Client = SupabaseClient<Database>;

/**
 * The benchmark server actions (spec 0008, AC-11): `updateCompanyFacts` writes the industry and
 * the headcount a client corrects and queues a new computation. Parses with the feature's schema,
 * updates through the members update policy, and triggers `benchmark-company` under the key
 * `benchmark/edit/<companyId>/<updated_at>`.
 */

export type BenchmarkActionError = "validation" | "forbidden" | "not_found" | "unexpected";

export type BenchmarkActionResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; error: BenchmarkActionError };

export type UpdateCompanyFactsData = { companyId: string; benchmarkQueued: boolean };

/** Two saves in the same microsecond collapse to one computation that reads the latest facts (AC-6). */
const EDIT_IDEMPOTENCY_TTL = "1h";

type Actor = {
  readonly supabase: Client;
  readonly organizationId: string;
};

/** A signed in client with an organization claim; authorization lives here, not only in the proxy. */
async function requireClient(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const organizationId = organizationIdFromClaims(claims);
  if (roleFromClaims(claims) !== "client" || typeof claims?.sub !== "string" || !organizationId) {
    return null;
  }
  return { supabase, organizationId };
}

function localeOf(input: unknown): Locale {
  return resolveLocale((input as { locale?: unknown } | null)?.locale);
}

/**
 * Saves the industry division and or the headcount (AC-11): a plain update of `industry_code`
 * and `employees_count` through the members update policy (zero rows updated is `not_found`),
 * reads `updated_at` back from the same statement, and triggers the benchmark with the
 * `updated_at` key. A trigger failure still answers `ok` with `benchmarkQueued` false and logs.
 * Server action, client member.
 */
export async function updateCompanyFacts(
  _previous: BenchmarkActionResult<UpdateCompanyFactsData> | null,
  input: unknown,
): Promise<BenchmarkActionResult<UpdateCompanyFactsData>> {
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(companyFactsFormSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, organizationId } = actor;
  const { companyId, industryCode, employeesCount } = parsed.data;

  const patch: Database["public"]["Tables"]["companies"]["Update"] = {
    ...(industryCode !== undefined ? { industry_code: industryCode } : {}),
    ...(employeesCount !== undefined ? { employees_count: employeesCount } : {}),
  };
  const { data, error } = await supabase
    .from("companies")
    .update(patch)
    .eq("id", companyId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .select("id, updated_at");
  if (error) return unexpected("update-company-facts", error, organizationId);
  const updated = data[0];
  if (!updated) return { ok: false, error: "not_found" };

  const benchmarkQueued = await triggerBenchmarkEdit(companyId, updated.updated_at, organizationId);
  log.info("company facts updated", {
    organizationId,
    companyId,
    industryCode: industryCode ?? null,
    employeesCount: employeesCount ?? null,
    benchmarkQueued,
  });
  return { ok: true, data: { companyId, benchmarkQueued } };
}

/** Queues the recomputation under the edit key (AC-6); false when the trigger failed. */
async function triggerBenchmarkEdit(
  companyId: string,
  updatedAt: string,
  organizationId: string,
): Promise<boolean> {
  if (!serverEnv().TRIGGER_SECRET_KEY) {
    log.warn("benchmark not queued after a facts edit: TRIGGER_SECRET_KEY is not set", {
      organizationId,
      companyId,
    });
    return false;
  }
  try {
    const idempotencyKey = await idempotencyKeys.create(
      `benchmark/edit/${companyId}/${updatedAt}`,
      { scope: "global" },
    );
    await tasks.trigger<typeof benchmarkCompanyTask>(
      "benchmark-company",
      { companyId, triggerKind: "client_edit" },
      { idempotencyKey, idempotencyKeyTTL: EDIT_IDEMPOTENCY_TTL },
    );
    return true;
  } catch (error) {
    log.error("benchmark trigger failed after a facts edit", {
      organizationId,
      companyId,
      reason: error instanceof Error ? error.message : String(error),
    });
    Sentry.captureException(error, {
      tags: { source: "update-company-facts" },
      extra: { organizationId, companyId },
    });
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
