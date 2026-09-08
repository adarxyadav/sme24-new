import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLatestSnapshot, type ParsedSnapshot } from "@/features/benchmark/queries";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";

/**
 * The ops admin reads (spec 0014). Queries throw on a database error, per the project's one error
 * handling rule; the typed result shape belongs to the actions. Each runs with the caller's own
 * client, so the existing `is_ops()` policies are the boundary and no policy is widened here.
 */

type Client = SupabaseClient<Database>;

/** How many experts the scheduling combobox offers; ops search within them. */
const ASSIGNABLE_EXPERTS_LIMIT = 200;

/** One option of the scheduling combobox: an expert who may be booked right now. */
export type AssignableExpert = {
  readonly expertId: string;
  readonly fullName: string | null;
  readonly headline: string | null;
};

/**
 * The experts ops may schedule (AC-3): every `active` profile, by name. Only a hint for the
 * picker, never the decision: `check_expert_assignable` is what refuses an expert deactivated
 * between this read and the write (AC-4). Throws. Server component, ops.
 */
export async function listAssignableExperts(
  supabase: Client,
): Promise<readonly AssignableExpert[]> {
  const { data, error } = await supabase
    .from("expert_profiles")
    .select("expert_id, headline, profiles!expert_profiles_expert_id_fkey(full_name)")
    .eq("status", "active")
    .limit(ASSIGNABLE_EXPERTS_LIMIT);
  if (error) throw queryError(error);

  return (data ?? [])
    .map((row) => {
      const { profiles } = row as typeof row & { profiles: { full_name: string | null } | null };
      return {
        expertId: row.expert_id,
        fullName: profiles?.full_name ?? null,
        headline: row.headline,
      };
    })
    .sort((a, b) => (a.fullName ?? "").localeCompare(b.fullName ?? ""));
}

/** An expert's name for one order row, keyed by the order's own `assigned_expert_id`. */
export type ScheduledExpertName = {
  readonly expertId: string;
  readonly fullName: string | null;
};

/**
 * The names behind the `assigned_expert_id` of a page of orders, as one query rather than one per
 * row; an id with no readable profile is simply absent from the map. Throws. Server component, ops.
 */
export async function expertNames(
  supabase: Client,
  expertIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  const unique = [...new Set(expertIds)];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  if (error) throw queryError(error);
  return new Map((data ?? []).map((row) => [row.id, row.full_name]));
}

/** One booked assessment as the client's dashboard shows it: the order, its date and its expert. */
export type ScheduledAssessment = {
  readonly orderId: string;
  readonly reference: string;
  readonly packageName: string;
  readonly status: string;
  readonly scheduledAt: string;
  readonly expertId: string;
};

/**
 * The organization's booked assessments, soonest first (AC-10). Runs with the caller's own client,
 * so the existing member select policy on `orders` is the boundary and a client sees only their
 * own; ops reading the same query for a client would see the same rows through the ops policy.
 *
 * It returns the order's own `assigned_expert_id` rather than joining the expert: the client half
 * of an expert's profile comes from `assigned_expert_summaries`, a definer view whose where clause
 * is the access boundary, so the two are matched in the component rather than joined here.
 * Throws. Server component.
 */
export async function listScheduledAssessments(
  supabase: Client,
): Promise<readonly ScheduledAssessment[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("id, reference, package_name_snapshot, status, scheduled_at, assigned_expert_id")
    .in("status", ["scheduled", "in_progress", "delivered"])
    .order("scheduled_at", { ascending: true });
  if (error) throw queryError(error);

  return (data ?? []).flatMap((row) =>
    // Both columns are not null in all three states by invariant 1, so a row missing either is a
    // row the database should not hold; skipping it is safer than rendering a card without a date.
    row.scheduled_at && row.assigned_expert_id
      ? [
          {
            orderId: row.id,
            reference: row.reference,
            packageName: row.package_name_snapshot,
            status: row.status,
            scheduledAt: row.scheduled_at,
            expertId: row.assigned_expert_id,
          },
        ]
      : [],
  );
}

/** How many companies one page of `/admin/companies` holds; the ops lists all use 20 to 50. */
export const COMPANIES_PAGE_SIZE = 25;

/** One row of the ops companies list: the company, whose it is and where its research stands. */
export type CompanyListRow = {
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly canton: string | null;
  readonly employeesCount: number | null;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  /** The status of the company's newest research run, or null when it has never had one. */
  readonly latestRunStatus: string | null;
  readonly latestRunAt: string | null;
};

export type CompanyPage = {
  readonly rows: readonly CompanyListRow[];
  /** The cursor of the next page, null on the last page. */
  readonly nextCursor: string | null;
};

/**
 * The ops companies list (AC-1): every company across every organization, newest first, on the
 * shared `(created_at, id)` keyset. The organization name is joined in the same request and the
 * latest run state is one batched read over the page's ids rather than one query per row.
 * RLS limits it to ops through the existing `companies: ops full access` policy.
 * Throws. Server component, ops.
 */
export async function listCompanies(supabase: Client, cursor: string | null): Promise<CompanyPage> {
  let query = supabase
    .from("companies")
    .select(
      "id, name, organization_id, canton, employees_count, archived_at, created_at, organizations(name)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(COMPANIES_PAGE_SIZE + 1);
  const decoded = decodeCursor(cursor ?? undefined);
  if (decoded) query = query.or(afterCursorFilter(decoded));

  const { data, error } = await query;
  if (error) throw queryError(error);

  const all = data ?? [];
  const hasMore = all.length > COMPANIES_PAGE_SIZE;
  const page = hasMore ? all.slice(0, COMPANIES_PAGE_SIZE) : all;
  const latest = await latestRunByCompany(
    supabase,
    page.map((row) => row.id),
  );

  const rows = page.map((row) => {
    const { organizations } = row as typeof row & { organizations: { name: string } | null };
    const run = latest.get(row.id);
    return {
      id: row.id,
      name: row.name,
      organizationId: row.organization_id,
      organizationName: organizations?.name ?? "—",
      canton: row.canton,
      employeesCount: row.employees_count,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      latestRunStatus: run?.status ?? null,
      latestRunAt: run?.createdAt ?? null,
    };
  });
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

/**
 * The newest research run of each of these companies, as one query rather than one per row: the
 * rows come back newest first, so the first sighting of a company id is its latest run and every
 * later one is skipped. A company that has never had a run is simply absent from the map.
 * Throws. Server component, ops.
 */
async function latestRunByCompany(
  supabase: Client,
  companyIds: readonly string[],
): Promise<ReadonlyMap<string, { readonly status: string; readonly createdAt: string }>> {
  if (companyIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("research_runs")
    .select("company_id, status, created_at")
    .in("company_id", [...companyIds])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw queryError(error);
  return (data ?? []).reduce((latest, row) => {
    if (!latest.has(row.company_id))
      latest.set(row.company_id, { status: row.status, createdAt: row.created_at });
    return latest;
  }, new Map<string, { status: string; createdAt: string }>());
}

/** One member of the company's organization as ops see them: who they are and their role. */
export type CompanyMember = {
  readonly userId: string;
  readonly role: string;
  readonly fullName: string | null;
  readonly locale: string | null;
};

/** One order of the company's organization, enough for the block without leaving the page. */
export type CompanyOrder = {
  readonly id: string;
  readonly reference: string;
  readonly packageName: string;
  readonly status: string;
  readonly grossRappen: number;
  readonly currency: string;
  readonly createdAt: string;
  readonly scheduledAt: string | null;
  readonly assignedExpertId: string | null;
};

/** Everything `/admin/companies/[companyId]` shows (AC-2). */
export type CompanyDetail = {
  readonly company: Tables<"companies">;
  readonly organization: Tables<"organizations"> | null;
  readonly members: readonly CompanyMember[];
  readonly runs: readonly Tables<"research_runs">[];
  /** The effective KPI rows of the latest succeeded run, client overrides included. */
  readonly kpis: readonly Tables<"company_kpi_current">[];
  /** The run those KPIs are shown against, null when the company has never had one succeed. */
  readonly latestSucceededRun: Tables<"research_runs"> | null;
  readonly snapshot: ParsedSnapshot | null;
  readonly orders: readonly CompanyOrder[];
  /** The active KPI catalogue, so a figure is named in the reader's language rather than by key. */
  readonly kpiCatalogue: readonly Tables<"kpi_definitions">[];
};

/**
 * One company as ops see it (AC-2): its facts, its organization and members, every research run,
 * the KPIs behind the latest succeeded run, the newest benchmark snapshot and every order of that
 * organization. Returns null when the id is not a uuid or RLS hides the row, which the page turns
 * into `notFound()`.
 *
 * The snapshot comes back through `loadLatestSnapshot`, so it is parsed by the schema its stored
 * `model_version` names rather than by naming one schema (docs/benchmark.md); an unreadable row is
 * reported and treated as absent there, and shows here as no snapshot.
 * Throws on a database error. Server component, ops.
 */
export async function getCompanyDetail(
  supabase: Client,
  companyId: string,
): Promise<CompanyDetail | null> {
  if (!isUuid(companyId)) return null;

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("*")
    .eq("id", companyId)
    .maybeSingle();
  if (companyError) throw queryError(companyError);
  if (!company) return null;

  // Every remaining read is keyed by the company or its organization, so none depends on another.
  const [organizationResult, membersResult, runsResult, ordersResult, snapshot, catalogueResult] =
    await Promise.all([
      supabase.from("organizations").select("*").eq("id", company.organization_id).maybeSingle(),
      supabase
        .from("organization_members")
        .select("user_id, role, profiles(full_name, locale)")
        .eq("organization_id", company.organization_id)
        .order("role", { ascending: true }),
      supabase
        .from("research_runs")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("orders")
        .select(
          "id, reference, package_name_snapshot, status, gross_rappen, currency, created_at, scheduled_at, assigned_expert_id",
        )
        .eq("organization_id", company.organization_id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      loadLatestSnapshot(supabase, companyId),
      supabase
        .from("kpi_definitions")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);

  if (organizationResult.error) throw queryError(organizationResult.error);
  if (catalogueResult.error) throw queryError(catalogueResult.error);
  if (membersResult.error) throw queryError(membersResult.error);
  if (runsResult.error) throw queryError(runsResult.error);
  if (ordersResult.error) throw queryError(ordersResult.error);

  const runs = runsResult.data ?? [];
  const latestSucceededRun = runs.find((run) => run.status === "succeeded") ?? null;
  // The effective rows come from the view, which already prefers a client entry over the research
  // one, so the block shows what the benchmark actually used rather than only what research found.
  const kpis = latestSucceededRun ? await currentKpis(supabase, companyId) : [];

  return {
    company,
    organization: organizationResult.data,
    members: (membersResult.data ?? []).map((row) => {
      const { profiles } = row as typeof row & {
        profiles: { full_name: string | null; locale: string | null } | null;
      };
      return {
        userId: row.user_id,
        role: row.role,
        fullName: profiles?.full_name ?? null,
        locale: profiles?.locale ?? null,
      };
    }),
    runs,
    kpis,
    latestSucceededRun,
    snapshot,
    orders: (ordersResult.data ?? []).map((row) => ({
      id: row.id,
      reference: row.reference,
      packageName: row.package_name_snapshot,
      status: row.status,
      grossRappen: Number(row.gross_rappen),
      currency: row.currency,
      createdAt: row.created_at,
      scheduledAt: row.scheduled_at,
      assignedExpertId: row.assigned_expert_id,
    })),
    kpiCatalogue: catalogueResult.data ?? [],
  };
}

/** The company's effective KPI rows, newest year first. Throws. Server component, ops. */
async function currentKpis(
  supabase: Client,
  companyId: string,
): Promise<readonly Tables<"company_kpi_current">[]> {
  const { data, error } = await supabase
    .from("company_kpi_current")
    .select("*")
    .eq("company_id", companyId)
    .order("period_year", { ascending: false })
    .order("kpi_key", { ascending: true });
  if (error) throw queryError(error);
  return data ?? [];
}
