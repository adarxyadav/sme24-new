import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";

/**
 * A secret key client for asserting rows the UI never shows (spec 0005 test scenarios): the
 * organization, the owner membership, the consent timestamp. Local stack only; every query filters
 * by an explicit id or email. Playwright.
 */
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are needed");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** True when the service client can be built (the local stack's keys are in the environment). */
export const dbAvailable = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY,
);

/** The profile, organization and membership of a user by email, or null when the user is unknown. */
export async function accountByEmail(email: string) {
  const supabase = serviceClient();
  const { data: users, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const user = users.users.find(
    (candidate) => candidate.email?.toLowerCase() === email.toLowerCase(),
  );
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, organization_id, full_name, locale, terms_accepted_at")
    .eq("id", user.id)
    .maybeSingle();
  const { data: memberships } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id);
  const organization = profile?.organization_id
    ? (
        await supabase
          .from("organizations")
          .select("id, name, created_by, locale")
          .eq("id", profile.organization_id)
          .maybeSingle()
      ).data
    : null;
  return { user, profile, memberships: memberships ?? [], organization };
}

/**
 * Removes a test account and, through the cascades, its profile and memberships, plus every
 * organization it created. Keyed on `created_by` rather than the profile's `organization_id`
 * alone: a membership removed by a probe, or an organization inserted by a server action still
 * in flight when the test gave up, otherwise leaves an organization behind that trips the pgTAP
 * seed guard. Errors surface so a leak is visible in the run, not in the next `pnpm test:db`.
 */
export async function deleteAccount(email: string) {
  const account = await accountByEmail(email);
  if (!account) return;
  const supabase = serviceClient();
  const { data: created, error: createdError } = await supabase
    .from("organizations")
    .select("id")
    .eq("created_by", account.user.id);
  if (createdError) throw createdError;
  const organizationIds = [
    ...new Set([
      ...(account.organization ? [account.organization.id] : []),
      ...(created ?? []).map((row) => row.id),
    ]),
  ];
  if (organizationIds.length > 0) {
    const { error } = await supabase.from("organizations").delete().in("id", organizationIds);
    if (error) throw error;
  }
  const { error } = await supabase.auth.admin.deleteUser(account.user.id);
  if (error) throw error;
}

/** True when the Supabase URL points at the local stack, the only place the sweep may run. */
const localStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
);

/**
 * Removes what earlier runs left behind on the local stack: every `@example.test` account
 * (`uniqueEmail` in mail.ts) with its organizations, and organizations nobody can reach any more
 * (no member, no creator), the trace of a worker killed by a timeout after its user was deleted.
 * A no op away from the local stack. Returns the counts for the log. Playwright global setup and
 * teardown.
 */
export async function sweepTestAccounts() {
  if (!dbAvailable || !localStack) return { users: 0, organizations: 0 };
  const supabase = serviceClient();
  const { data: users, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const stale = users.users.filter((user) => user.email?.toLowerCase().endsWith("@example.test"));
  for (const user of stale) {
    await deleteAccount(user.email as string);
  }
  const { data: orphans, error: orphanError } = await supabase
    .from("organizations")
    .select("id, organization_members(user_id)")
    .is("created_by", null);
  if (orphanError) throw orphanError;
  const orphanIds = (orphans ?? [])
    .filter((row) => row.organization_members.length === 0)
    .map((row) => row.id);
  if (orphanIds.length > 0) {
    const { error: deleteError } = await supabase
      .from("organizations")
      .delete()
      .in("id", orphanIds);
    if (deleteError) throw deleteError;
  }
  return { users: stale.length, organizations: orphanIds.length };
}

/**
 * A confirmed client whose sign up metadata still holds the company name and consent, the state
 * a password or code sign up is in right after confirmation and before its first sign in.
 */
export async function createConfirmedClient(
  email: string,
  password: string,
  organizationName = "Fixture AG",
) {
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: "Fixture Person",
      locale: "de",
      organization_name: organizationName,
      terms_accepted_at: new Date().toISOString(),
    },
  });
  if (error) throw error;
}

/** A confirmed client without any sign up metadata: what a provider sign up looks like. */
export async function createBareClient(email: string, password: string) {
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Pia Provider" },
  });
  if (error) throw error;
}

/** A client who signed up with a password and never followed the confirmation link. */
export async function createUnconfirmedClient(email: string, password: string) {
  const supabase = serviceClient();
  const { error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
    user_metadata: { full_name: "Uwe Unconfirmed", locale: "de" },
  });
  if (error) throw error;
}

/**
 * A company of the organization with one finished research run, the state the dashboard needs
 * before the self assessment form prefills from research rows (spec 0010, AC-11). Returns the
 * company and run ids; `deleteAccount` removes both through the organization cascade.
 */
export async function seedResearchedCompany(input: {
  readonly organizationId: string;
  readonly userId: string;
  readonly name: string;
  readonly status?: "succeeded" | "empty" | "failed";
  /**
   * The company's NOGA code. Defaults to section C, whose seeded peer row carries a real spread.
   * A caller that wants the point row path (spec 0016, AC-15) passes a division of a section whose
   * peer row holds one figure repeated as all three quartiles, for example `35` for section D.
   */
  readonly industryCode?: string;
  readonly employeesCount?: number;
}) {
  const supabase = serviceClient();
  const { data: company, error } = await supabase
    .from("companies")
    .insert({
      organization_id: input.organizationId,
      name: input.name,
      created_by: input.userId,
      industry_code: input.industryCode ?? "23.61",
      employees_count: input.employeesCount ?? 420,
    })
    .select("id")
    .single();
  if (error) throw error;
  const now = new Date().toISOString();
  const { data: run, error: runError } = await supabase
    .from("research_runs")
    .insert({
      organization_id: input.organizationId,
      company_id: company.id,
      requested_by: input.userId,
      status: input.status ?? "succeeded",
      started_at: now,
      finished_at: now,
      error_code: input.status === "failed" ? "internal" : null,
    })
    .select("id")
    .single();
  if (runError) throw runError;
  return { companyId: company.id, runId: run.id };
}

/** A research row as the task stores it (spec 0010, AC-11): `source 'research'`, one confidence, no sources. */
export async function seedCompanyKpi(input: {
  readonly organizationId: string;
  readonly companyId: string;
  readonly runId: string;
  readonly kpiKey: string;
  readonly periodYear: number;
  readonly value: number;
  readonly confidence?: number;
}) {
  const supabase = serviceClient();
  const { error } = await supabase.from("company_kpis").insert({
    organization_id: input.organizationId,
    company_id: input.companyId,
    research_run_id: input.runId,
    kpi_key: input.kpiKey,
    period_year: input.periodYear,
    value: input.value,
    source: "research",
    confidence: input.confidence ?? 0.9,
    sources: [],
  });
  if (error) throw error;
}

/** The local stack's Postgres, the one place `purgeAuditRows` may connect. */
const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Removes the audit rows a spec's own writes produced, so the pgTAP suites that count audit
 * rows per table (`assessment_answers.test.sql` counts every insert) still see only what the
 * seed and their own statements produce. `audit_log` is append only for every role including the
 * service role, guarded by the `audit_log_protect` trigger, which yields only to the
 * `app.audit_maintenance` setting inside the deleting transaction; that needs a SQL session, so
 * this shells out to `psql` against the local stack (`SUPABASE_DB_URL` overrides the default).
 * A no op away from the local stack, where pgTAP never runs. Every id is checked to be a UUID
 * before it is interpolated. Playwright, after a spec's fixtures are gone.
 */
export function purgeAuditRows(input: {
  /** The tables whose rows with one of `rowIds` are removed. */
  readonly tables: readonly string[];
  readonly rowIds: readonly string[];
  /** Answer rows are keyed by their assessment, because the UI created them and their ids are unknown. */
  readonly assessmentIds?: readonly string[];
}) {
  if (!localStack) return;
  const ids = [...input.rowIds, ...(input.assessmentIds ?? [])];
  for (const id of ids) {
    if (!UUID.test(id)) throw new Error(`purgeAuditRows: not a UUID: ${id}`);
  }
  for (const table of input.tables) {
    if (!/^[a-z_]+$/.test(table)) throw new Error(`purgeAuditRows: not a table name: ${table}`);
  }
  const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
  const statements = [
    "begin;",
    "set local app.audit_maintenance = 'on';",
    input.rowIds.length > 0
      ? `delete from public.audit_log where table_name in (${list(input.tables)}) and row_id in (${list(input.rowIds)});`
      : "",
    input.assessmentIds && input.assessmentIds.length > 0
      ? `delete from public.audit_log where table_name = 'assessment_answers' and coalesce(new_data, old_data) ->> 'assessment_id' in (${list(input.assessmentIds)});`
      : "",
    "commit;",
  ].filter(Boolean);
  execFileSync(
    "psql",
    [
      process.env.SUPABASE_DB_URL ?? LOCAL_DB_URL,
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
      "-c",
      statements.join("\n"),
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
}
