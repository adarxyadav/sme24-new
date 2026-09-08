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

/** How many rows each queue section holds; a longer queue is worked from that section's own list. */
const QUEUE_SECTION_LIMIT = 10;

/** One paid order still waiting for a date and an assessor (AC-11). */
export type UnscheduledOrder = {
  readonly id: string;
  readonly reference: string;
  readonly packageName: string;
  readonly organizationName: string;
  readonly paidAt: string | null;
};

/** One booked order whose date has arrived or passed while its status still says it is open. */
export type OverdueOrder = {
  readonly id: string;
  readonly reference: string;
  readonly packageName: string;
  readonly organizationName: string;
  readonly status: string;
  readonly scheduledAt: string;
};

/** One enquiry nobody has picked up yet. */
export type NewEnquiry = {
  readonly id: string;
  readonly companyName: string | null;
  readonly createdAt: string;
};

/** One product email that never reached its recipient. */
export type FailedDelivery = {
  readonly id: string;
  readonly template: string;
  readonly status: string;
  readonly createdAt: string;
};

/** One research run that gave up, with the code that says why. */
export type FailedRun = {
  readonly id: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly errorCode: string | null;
  readonly createdAt: string;
};

/** The five things that can be waiting on ops when they sign in (AC-11). */
export type OpsQueue = {
  readonly unscheduledOrders: readonly UnscheduledOrder[];
  readonly overdueOrders: readonly OverdueOrder[];
  readonly newEnquiries: readonly NewEnquiry[];
  readonly failedDeliveries: readonly FailedDelivery[];
  readonly failedRuns: readonly FailedRun[];
};

/**
 * The work waiting on ops (AC-11): paid orders with no date, booked orders whose date has come and
 * gone, new enquiries, failed email deliveries and failed research runs, each capped at ten with
 * its own list behind it.
 *
 * The five reads are independent, so they run together. "Overdue" is `scheduled_at <= now()` with
 * a status still `scheduled` or `in_progress`; the comparison is made in the database, whose clock
 * is the one the transition trigger already uses, and the instant is absolute, so no zone
 * conversion happens here — the rendering is what carries `Europe/Zurich`.
 *
 * Both order reads ride the partial indexes milestone 1 added (`orders_paid_unscheduled_idx` and
 * `orders_scheduled_at_idx`), so neither scans the table as orders accumulate.
 * Throws. Server component, ops.
 */
export async function listOpsQueue(supabase: Client): Promise<OpsQueue> {
  const nowIso = new Date().toISOString();
  const [unscheduled, overdue, enquiries, deliveries, runs] = await Promise.all([
    supabase
      .from("orders")
      .select("id, reference, package_name_snapshot, paid_at, organizations(name)")
      .eq("status", "paid")
      .order("paid_at", { ascending: true })
      .limit(QUEUE_SECTION_LIMIT),
    supabase
      .from("orders")
      .select("id, reference, package_name_snapshot, status, scheduled_at, organizations(name)")
      .in("status", ["scheduled", "in_progress"])
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(QUEUE_SECTION_LIMIT),
    supabase
      .from("enquiries")
      .select("id, company_name, created_at")
      .eq("status", "new")
      .order("created_at", { ascending: false })
      .limit(QUEUE_SECTION_LIMIT),
    supabase
      .from("email_deliveries")
      .select("id, template, status, created_at")
      .in("status", ["failed", "bounced"])
      .order("created_at", { ascending: false })
      .limit(QUEUE_SECTION_LIMIT),
    supabase
      .from("research_runs")
      .select("id, company_id, error_code, created_at, companies(name)")
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(QUEUE_SECTION_LIMIT),
  ]);

  if (unscheduled.error) throw queryError(unscheduled.error);
  if (overdue.error) throw queryError(overdue.error);
  if (enquiries.error) throw queryError(enquiries.error);
  if (deliveries.error) throw queryError(deliveries.error);
  if (runs.error) throw queryError(runs.error);

  return {
    unscheduledOrders: (unscheduled.data ?? []).map((row) => {
      const { organizations } = row as typeof row & { organizations: { name: string } | null };
      return {
        id: row.id,
        reference: row.reference,
        packageName: row.package_name_snapshot,
        organizationName: organizations?.name ?? "—",
        paidAt: row.paid_at,
      };
    }),
    overdueOrders: (overdue.data ?? []).flatMap((row) => {
      const { organizations } = row as typeof row & { organizations: { name: string } | null };
      // `scheduled_at` is not null in both states by invariant 1, and the filter above already
      // compared it; the guard is only what narrows the nullable column type.
      return row.scheduled_at
        ? [
            {
              id: row.id,
              reference: row.reference,
              packageName: row.package_name_snapshot,
              organizationName: organizations?.name ?? "—",
              status: row.status,
              scheduledAt: row.scheduled_at,
            },
          ]
        : [];
    }),
    newEnquiries: (enquiries.data ?? []).map((row) => ({
      id: row.id,
      companyName: row.company_name,
      createdAt: row.created_at,
    })),
    failedDeliveries: (deliveries.data ?? []).map((row) => ({
      id: row.id,
      template: row.template,
      status: row.status,
      createdAt: row.created_at,
    })),
    failedRuns: (runs.data ?? []).map((row) => {
      const { companies } = row as typeof row & { companies: { name: string } | null };
      return {
        id: row.id,
        companyId: row.company_id,
        companyName: companies?.name ?? "—",
        errorCode: row.error_code,
        createdAt: row.created_at,
      };
    }),
  };
}

/** The tallies the overview tiles show (AC-11); an order status with no rows is simply absent. */
export type OpsCounts = {
  readonly companies: number;
  readonly openResearchRuns: number;
  readonly activeExperts: number;
  /** One entry per `orders.status` that has at least one row, keyed by the status. */
  readonly ordersByStatus: ReadonlyMap<string, number>;
};

/**
 * The overview counts (AC-11). Each is a `head: true` count, so Postgres answers with the number
 * and never ships the rows; the orders tally is one grouped read of the status column rather than
 * one count per status, because the eight statuses would otherwise be eight round trips.
 * Throws. Server component, ops.
 */
export async function listOpsCounts(supabase: Client): Promise<OpsCounts> {
  const [companies, openRuns, experts, orderStatuses] = await Promise.all([
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase
      .from("research_runs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"]),
    supabase
      .from("expert_profiles")
      .select("expert_id", { count: "exact", head: true })
      .eq("status", "active"),
    supabase.from("orders").select("status"),
  ]);

  if (companies.error) throw queryError(companies.error);
  if (openRuns.error) throw queryError(openRuns.error);
  if (experts.error) throw queryError(experts.error);
  if (orderStatuses.error) throw queryError(orderStatuses.error);

  return {
    companies: companies.count ?? 0,
    openResearchRuns: openRuns.count ?? 0,
    activeExperts: experts.count ?? 0,
    ordersByStatus: (orderStatuses.data ?? []).reduce(
      (counts, row) => counts.set(row.status, (counts.get(row.status) ?? 0) + 1),
      new Map<string, number>(),
    ),
  };
}
