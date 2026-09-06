import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { RUN_LIMIT_PER_DAY, YEARS_PER_RUN } from "./catalogue";
import { parseSummary, type ResearchSummary } from "./summary";

type Client = SupabaseClient<Database>;

export type Company = Tables<"companies">;
export type RunRow = Tables<"research_runs">;
export type KpiDefinitionRow = Tables<"kpi_definitions">;
export type KpiCurrentRow = Tables<"company_kpi_current">;

export type LatestRun = RunRow & { readonly parsedSummary: ResearchSummary | null };

export type DashboardKpi = KpiCurrentRow & {
  /** `skipped` when the row's run ran without the validation pass (AC-7), else `passed`. */
  readonly validation: "passed" | "skipped";
};

export type Quota = {
  readonly used: number;
  readonly limit: number;
  readonly remaining: number;
  readonly openRunId: string | null;
};

export type CompanyDashboard = {
  readonly company: Company | null;
  readonly latestRun: LatestRun | null;
  readonly kpis: readonly DashboardKpi[];
  /** The three newest reporting years present in `company_kpi_current` (AC-7), newest first. */
  readonly years: readonly number[];
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly quota: Quota;
};

/** The reporting years the table shows: the three highest present, newest first. Pure. */
export function newestYears(
  rows: ReadonlyArray<{ period_year: number | null }>,
): readonly number[] {
  const years = [
    ...new Set(rows.flatMap((row) => (row.period_year === null ? [] : [row.period_year]))),
  ];
  return years.sort((a, b) => b - a).slice(0, YEARS_PER_RUN);
}

/**
 * Everything `/app` renders (spec 0007, AC-7, AC-8): the organization's company, its latest run
 * with the parsed summary, the effective KPI rows for the three newest years joined to their
 * run's validation flag, the active catalogue in sort order, and the daily quota (the same rule
 * as the SQL helper, RLS scoped, a courtesy count; the policy is the guard). Throws on a database
 * error. Server component.
 */
export async function getCompanyDashboard(
  supabase: Client,
  organizationId: string,
  now: Date = new Date(),
): Promise<CompanyDashboard> {
  const [company, catalogue, quota] = await Promise.all([
    loadCompany(supabase, organizationId),
    loadCatalogue(supabase),
    loadQuota(supabase, organizationId, now),
  ]);
  if (!company) return { company: null, latestRun: null, kpis: [], years: [], catalogue, quota };

  const [latestRun, currentRows] = await Promise.all([
    loadLatestRun(supabase, company.id),
    loadCurrentKpis(supabase, company.id),
  ]);
  const years = newestYears(currentRows);
  const rows = currentRows.filter(
    (row) => row.period_year !== null && years.includes(row.period_year),
  );
  const validationByRun = await loadValidation(supabase, rows);
  const kpis = rows.map((row) => ({
    ...row,
    validation: (row.research_run_id ? validationByRun.get(row.research_run_id) : null) ?? "passed",
  }));
  return { company, latestRun, kpis, years, catalogue, quota };
}

async function loadCompany(supabase: Client, organizationId: string): Promise<Company | null> {
  const { data, error } = await supabase
    .from("companies")
    .select("*")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    // The same order the actions use to settle a concurrent insert, id breaking a tie.
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadCatalogue(supabase: Client): Promise<readonly KpiDefinitionRow[]> {
  const { data, error } = await supabase
    .from("kpi_definitions")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data;
}

async function loadLatestRun(supabase: Client, companyId: string): Promise<LatestRun | null> {
  const { data, error } = await supabase
    .from("research_runs")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? { ...data, parsedSummary: parseSummary(data.summary) } : null;
}

async function loadCurrentKpis(
  supabase: Client,
  companyId: string,
): Promise<readonly KpiCurrentRow[]> {
  const { data, error } = await supabase
    .from("company_kpi_current")
    .select("*")
    .eq("company_id", companyId);
  if (error) throw error;
  return data;
}

/** The validation flag of every run the rows point at, in a second query (AC-7). */
async function loadValidation(
  supabase: Client,
  rows: ReadonlyArray<{ research_run_id: string | null }>,
): Promise<ReadonlyMap<string, "passed" | "skipped">> {
  const runIds = [
    ...new Set(rows.flatMap((row) => (row.research_run_id ? [row.research_run_id] : []))),
  ];
  if (runIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("research_runs")
    .select("id, summary")
    .in("id", runIds);
  if (error) throw error;
  return new Map(
    data.map((run) => [
      run.id,
      parseSummary(run.summary)?.validation === "skipped" ? "skipped" : "passed",
    ]),
  );
}

/** The daily quota (AC-8): runs in the last 24 hours, `trigger_failed` rows excluded, plus the open run if any. */
async function loadQuota(supabase: Client, organizationId: string, now: Date): Promise<Quota> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [{ count, error }, { data: open, error: openError }] = await Promise.all([
    supabase
      .from("research_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .gt("created_at", since)
      .or("error_code.is.null,error_code.neq.trigger_failed"),
    supabase
      .from("research_runs")
      .select("id")
      .eq("organization_id", organizationId)
      .in("status", ["queued", "running"])
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) throw error;
  if (openError) throw openError;
  const used = count ?? 0;
  return {
    used,
    limit: RUN_LIMIT_PER_DAY,
    remaining: Math.max(0, RUN_LIMIT_PER_DAY - used),
    openRunId: open?.id ?? null,
  };
}
