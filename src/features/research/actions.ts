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
import type { researchCompanyTask } from "@/trigger/research-company";
import { classifyRunInsertError, type RunInsertError } from "./errors";
import { lookupSchema, rerunSchema } from "./schema";

type Client = SupabaseClient<Database>;

/**
 * The research server actions (spec 0007, AC-3, AC-8, AC-9): `requestResearch` creates the
 * company and its first run, `rerunResearch` edits the company and starts the next run. Both
 * parse their input with the feature's schema, insert the run under the members insert policy
 * (the open run index and the daily quota are the guards), trigger `research-company` under the
 * idempotency key `research/<runId>` and store the Trigger.dev run id. A failed trigger moves the
 * run to `failed` (`trigger_failed`) and still answers `ok`, so the dashboard renders the state.
 */

export type ResearchActionError = "validation" | "forbidden" | "not_found" | RunInsertError;

export type ResearchActionResult<Data> =
  | { ok: true; data: Data }
  | { ok: false; error: "company_exists"; companyId: string }
  | { ok: false; error: ResearchActionError };

export type RequestResearchData = { companyId: string; runId: string };
export type RerunResearchData = { runId: string };

/** Only Swiss companies are in scope (spec 0001), so the country is a constant. */
const COUNTRY = "CH";
/** How long the global key blocks a second trigger of the same run. */
const IDEMPOTENCY_TTL = "24h";

type Actor = {
  readonly supabase: Client;
  readonly userId: string;
  readonly organizationId: string;
};

/** A signed in client with an organization claim; authorization lives here, not only in the proxy (AC-14). */
async function requireClient(): Promise<Actor | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const organizationId = organizationIdFromClaims(claims);
  if (roleFromClaims(claims) !== "client" || typeof claims?.sub !== "string" || !organizationId) {
    return null;
  }
  return { supabase, userId: claims.sub, organizationId };
}

function localeOf(input: unknown): Locale {
  return resolveLocale((input as { locale?: unknown } | null)?.locale);
}

/**
 * Starts the first research (AC-3): answers `company_exists` with the id when the organization
 * already has a non archived company, else inserts the company (`name`, `website`, `country`
 * `CH`, `created_by`) and its queued run, triggers the task and stores the run id. Server action,
 * client member.
 */
export async function requestResearch(
  _previous: ResearchActionResult<RequestResearchData> | null,
  input: unknown,
): Promise<ResearchActionResult<RequestResearchData>> {
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(lookupSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, organizationId, userId } = actor;

  const { data: existing, error: existingError } = await supabase
    .from("companies")
    .select("id")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existingError) return unexpected("request-research", existingError, organizationId);
  if (existing) return { ok: false, error: "company_exists", companyId: existing.id };

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .insert({
      organization_id: organizationId,
      name: parsed.data.name,
      website: parsed.data.website,
      country: COUNTRY,
      created_by: userId,
    })
    .select("id")
    .single();
  if (companyError) return unexpected("request-research", companyError, organizationId);

  const run = await startRun(actor, company.id);
  if (!run.ok) return run;
  return { ok: true, data: { companyId: company.id, runId: run.data.runId } };
}

/**
 * Edits the company and runs the research again (AC-8): a plain update of `name`, `legal_name`
 * and `website` through the members update policy (the client's values always win over
 * research; zero rows updated is `not_found`), then the next run exactly as `requestResearch`.
 * Server action, client member.
 */
export async function rerunResearch(
  _previous: ResearchActionResult<RerunResearchData> | null,
  input: unknown,
): Promise<ResearchActionResult<RerunResearchData>> {
  const actor = await requireClient();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = parseWith(rerunSchema, input, localeOf(input));
  if (!parsed.success) return { ok: false, error: "validation" };
  const { supabase, organizationId } = actor;

  const { data: updated, error: updateError } = await supabase
    .from("companies")
    .update({
      name: parsed.data.name,
      legal_name: parsed.data.legalName,
      website: parsed.data.website,
    })
    .eq("id", parsed.data.companyId)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .select("id");
  if (updateError) return unexpected("rerun-research", updateError, organizationId);
  if (updated.length === 0) return { ok: false, error: "not_found" };

  return startRun(actor, parsed.data.companyId);
}

/**
 * Inserts the queued run (the policy and the open run index decide, AC-9), triggers the task
 * under `research/<runId>` and stores `trigger_run_id` through the members update policy; a
 * failed trigger closes the run as `trigger_failed` and still answers `ok` (AC-3).
 */
async function startRun(
  { supabase, organizationId, userId }: Actor,
  companyId: string,
): Promise<ResearchActionResult<RerunResearchData>> {
  const { data: run, error: runError } = await supabase
    .from("research_runs")
    .insert({
      organization_id: organizationId,
      company_id: companyId,
      requested_by: userId,
      status: "queued",
    })
    .select("id")
    .single();
  if (runError) {
    const code = classifyRunInsertError(runError);
    if (code === "unexpected") return unexpected("start-research-run", runError, organizationId);
    log.info("research run refused", { organizationId, companyId, reason: code });
    return { ok: false, error: code };
  }
  const runId = run.id;

  const trigger = await triggerResearch(runId);
  if (trigger.ok) {
    const { error } = await supabase
      .from("research_runs")
      .update({ trigger_run_id: trigger.triggerRunId })
      .eq("id", runId);
    if (error) log.warn("trigger_run_id not stored", { runId, reason: error.message });
    log.info("research requested", {
      organizationId,
      companyId,
      runId,
      triggerRunId: trigger.triggerRunId,
    });
    return { ok: true, data: { runId } };
  }

  const { error } = await supabase
    .from("research_runs")
    .update({
      status: "failed",
      error_code: "trigger_failed",
      error_message: "The research could not be started.",
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) log.warn("trigger_failed not stored", { runId, reason: error.message });
  log.error("research trigger failed", {
    organizationId,
    companyId,
    runId,
    reason: trigger.reason,
  });
  if (process.env.VERCEL_ENV) {
    Sentry.captureException(trigger.error, {
      tags: { source: "trigger", task: "research-company", research_run_id: runId },
      extra: { organizationId },
    });
  }
  return { ok: true, data: { runId } };
}

type TriggerOutcome =
  | { ok: true; triggerRunId: string }
  | { ok: false; reason: string; error: unknown };

async function triggerResearch(runId: string): Promise<TriggerOutcome> {
  if (!serverEnv().TRIGGER_SECRET_KEY) {
    return {
      ok: false,
      reason: "TRIGGER_SECRET_KEY is not set",
      error: new Error("no trigger key"),
    };
  }
  try {
    const idempotencyKey = await idempotencyKeys.create(`research/${runId}`, { scope: "global" });
    const handle = await tasks.trigger<typeof researchCompanyTask>(
      "research-company",
      { runId },
      { idempotencyKey, idempotencyKeyTTL: IDEMPOTENCY_TTL },
    );
    return { ok: true, triggerRunId: handle.id };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), error };
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
