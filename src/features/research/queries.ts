import type { SupabaseClient } from "@supabase/supabase-js";
import type { BenchmarkState } from "@/features/benchmark/catalogue";
import {
  type AssumptionRow,
  benchmarkStateOf,
  loadAssumptionRows,
  loadLatestSnapshot,
  type ParsedSnapshot,
} from "@/features/benchmark/queries";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { isKpiKey, type KpiKey, RUN_LIMIT_PER_DAY, YEARS_PER_RUN } from "./catalogue";
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

/** One `company_kpi_current` row narrowed for the self assessment form (spec 0010, AC-10). */
export type KpiRow = {
  readonly id: string;
  readonly kpiKey: KpiKey;
  readonly periodYear: number;
  readonly value: number;
  readonly source: "research" | "client";
  readonly updatedAt: string;
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
  /** The newest parsed benchmark snapshot (spec 0008, AC-9), `null` when none is readable. */
  readonly benchmark: ParsedSnapshot | null;
  readonly benchmarkState: BenchmarkState;
  /** The assumption rows (labels and notes) the disclosure names by key (spec 0008, AC-10). */
  readonly benchmarkAssumptions: readonly AssumptionRow[];
  /** Every current row of the company, narrowed and ordered by KPI then year descending (spec 0010, AC-10). */
  readonly kpiRows: readonly KpiRow[];
  /** The newest `updated_at` among the client rows (spec 0010, AC-10, AC-13), `null` without one. */
  readonly clientKpiUpdatedAt: string | null;
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
 * The view rows narrowed to what the form needs (spec 0010, AC-10): a row with a null id, key,
 * year, value, source or `updated_at` (every view column is nullable in the generated types) or
 * an unknown key is dropped; ordered by `kpi_key`, then `period_year` descending. Pure.
 */
export function toKpiRows(rows: readonly KpiCurrentRow[]): readonly KpiRow[] {
  return rows
    .flatMap((row): KpiRow[] => {
      if (
        row.id === null ||
        row.period_year === null ||
        row.value === null ||
        row.updated_at === null ||
        !isKpiKey(row.kpi_key) ||
        (row.source !== "research" && row.source !== "client")
      ) {
        return [];
      }
      return [
        {
          id: row.id,
          kpiKey: row.kpi_key,
          periodYear: row.period_year,
          value: Number(row.value),
          source: row.source,
          updatedAt: row.updated_at,
        },
      ];
    })
    .sort((a, b) => a.kpiKey.localeCompare(b.kpiKey) || b.periodYear - a.periodYear);
}

/** The newest `updatedAt` among the client rows (spec 0010, AC-10), `null` when there is none. Pure. */
export function newestClientMoment(rows: readonly KpiRow[]): string | null {
  return rows
    .filter((row) => row.source === "client")
    .reduce<string | null>(
      (newest, row) => (newest === null || row.updatedAt > newest ? row.updatedAt : newest),
      null,
    );
}

/**
 * Everything `/app` renders (spec 0007, AC-7, AC-8): the organization's company, its latest run
 * with the parsed summary, the effective KPI rows for the three newest years joined to their
 * run's validation flag, the active catalogue in sort order, and the daily quota (the same rule
 * as the SQL helper, RLS scoped, a courtesy count; the policy is the guard), plus the newest
 * benchmark snapshot and the derived benchmark state (spec 0008, AC-9), plus the narrowed rows
 * the self assessment form prefills from (spec 0010, AC-10). Throws on a database error. Server
 * component.
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
  if (!company) {
    return {
      company: null,
      latestRun: null,
      kpis: [],
      years: [],
      catalogue,
      quota,
      benchmark: null,
      benchmarkState: "unavailable",
      benchmarkAssumptions: [],
      kpiRows: [],
      clientKpiUpdatedAt: null,
    };
  }

  const [latestRun, currentRows, benchmark] = await Promise.all([
    loadLatestRun(supabase, company.id),
    loadCurrentKpis(supabase, company.id),
    loadLatestSnapshot(supabase, company.id),
  ]);
  const benchmarkAssumptions = benchmark ? await loadAssumptionRows(supabase) : [];
  const years = newestYears(currentRows);
  const rows = currentRows.filter(
    (row) => row.period_year !== null && years.includes(row.period_year),
  );
  const validationByRun = await loadValidation(supabase, rows);
  const kpis = rows.map((row) => ({
    ...row,
    validation: (row.research_run_id ? validationByRun.get(row.research_run_id) : null) ?? "passed",
  }));
  const kpiRows = toKpiRows(currentRows);
  const clientKpiUpdatedAt = newestClientMoment(kpiRows);
  const benchmarkState = benchmarkStateOf({
    snapshot: benchmark,
    latestRun,
    companyUpdatedAt: company.updated_at,
    clientKpiUpdatedAt,
    now,
  });
  return {
    company,
    latestRun,
    kpis,
    years,
    catalogue,
    quota,
    benchmark,
    benchmarkState,
    benchmarkAssumptions,
    kpiRows,
    clientKpiUpdatedAt,
  };
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
  if (error) throw queryError(error);
  return data;
}

async function loadCatalogue(supabase: Client): Promise<readonly KpiDefinitionRow[]> {
  const { data, error } = await supabase
    .from("kpi_definitions")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw queryError(error);
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
  if (error) throw queryError(error);
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
  if (error) throw queryError(error);
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
  if (error) throw queryError(error);
  return new Map(
    data.map((run) => [
      run.id,
      parseSummary(run.summary)?.validation === "skipped" ? "skipped" : "passed",
    ]),
  );
}

/**
 * The daily quota (AC-8): runs in the last 24 hours, `trigger_failed` rows excluded, plus the open
 * run if any. This is only what the dashboard displays; `private.research_run_allowed` is the
 * guard that actually refuses the insert, so the two must count the same rows. The PostgREST
 * `error_code.is.null,error_code.neq.trigger_failed` below is `error_code is distinct from
 * 'trigger_failed'`, and `supabase/tests/research_runs.test.sql` asserts the two agree.
 */
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
  if (error) throw queryError(error);
  if (openError) throw queryError(openError);
  const used = count ?? 0;
  return {
    used,
    limit: RUN_LIMIT_PER_DAY,
    remaining: Math.max(0, RUN_LIMIT_PER_DAY - used),
    openRunId: open?.id ?? null,
  };
}
