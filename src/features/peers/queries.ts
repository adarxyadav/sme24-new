import type { SupabaseClient } from "@supabase/supabase-js";
import type { SizeBand } from "@/features/benchmark/catalogue";
import { isKpiKey, type KpiKey } from "@/features/research/catalogue";
import { type KpiSource, parseKpiSources } from "@/features/research/summary";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { HOUSE_ORGANIZATION_ID, PEER_REFRESH_MAX_FAILURES, type PeerStatus } from "./catalogue";
import { ALL, type PeerFilters } from "./schema";

type Client = SupabaseClient<Database>;

export type PeerRow = Tables<"peer_companies">;

/** The company facts the ops list shows beside a peer. */
export type PeerCompanyFacts = {
  readonly id: string;
  readonly name: string;
  readonly legal_name: string | null;
  readonly website: string | null;
  readonly industry_code: string | null;
  readonly employees_count: number | null;
};

/** One row of `/admin/peers` (AC-2, AC-14): the peer, its company, its KPI count and its run state. */
export type PeerAdminRow = PeerRow & {
  readonly company: PeerCompanyFacts;
  readonly kpiCount: number;
  readonly openRun: { readonly id: string; readonly status: string } | null;
  readonly lastRun: {
    readonly id: string;
    readonly status: string;
    readonly error_code: string | null;
    readonly finished_at: string | null;
  } | null;
  /** True at `PEER_REFRESH_MAX_FAILURES` consecutive failures: the schedule skips it until ops act. */
  readonly flagged: boolean;
};

/** The most rows the ops list shows at once; the section, band and status filters keep it below. */
const ADMIN_LIST_LIMIT = 500;

/**
 * The ops list of peers (AC-2, AC-14): every peer matching the filters with its company, the
 * number of KPI values on file, the open run if any and the last run, ordered by section, band,
 * status and creation. RLS limits it to the ops role. Throws on a database error. Server component.
 */
export async function listPeers(
  supabase: Client,
  filters: PeerFilters,
): Promise<readonly PeerAdminRow[]> {
  let query = supabase
    .from("peer_companies")
    .select(
      "*, company:companies!inner(id, name, legal_name, website, industry_code, employees_count), last_run:research_runs!peer_companies_last_run_id_fkey(id, status, error_code, finished_at)",
    )
    .order("industry_section", { ascending: true })
    .order("size_band", { ascending: true })
    .order("status", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(ADMIN_LIST_LIMIT);
  if (filters.section !== ALL) query = query.eq("industry_section", filters.section);
  if (filters.sizeBand !== ALL) query = query.eq("size_band", filters.sizeBand);
  if (filters.status !== ALL) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) throw queryError(error);
  const companyIds = data.map((row) => row.company_id);
  const [kpiCounts, openRuns] = await Promise.all([
    countKpis(supabase, companyIds),
    loadOpenRuns(supabase, companyIds),
  ]);
  return data.map(({ company, last_run, ...row }) => ({
    ...row,
    company,
    kpiCount: kpiCounts.get(row.company_id) ?? 0,
    openRun: openRuns.get(row.company_id) ?? null,
    lastRun: last_run,
    flagged: row.failed_refreshes >= PEER_REFRESH_MAX_FAILURES,
  }));
}

async function countKpis(
  supabase: Client,
  companyIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (companyIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("company_kpis")
    .select("company_id")
    .in("company_id", [...companyIds]);
  if (error) throw queryError(error);
  return data.reduce<Map<string, number>>((counts, row) => {
    counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
    return counts;
  }, new Map());
}

async function loadOpenRuns(
  supabase: Client,
  companyIds: readonly string[],
): Promise<ReadonlyMap<string, { readonly id: string; readonly status: string }>> {
  if (companyIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("research_runs")
    .select("id, company_id, status")
    .in("company_id", [...companyIds])
    .in("status", ["queued", "running"]);
  if (error) throw queryError(error);
  return new Map(data.map((run) => [run.company_id, { id: run.id, status: run.status }]));
}

/** One peer KPI value as the benchmark model receives it (AC-8): the peer's label, never its name. */
export type PeerSetRow = {
  readonly peerId: string;
  readonly companyId: string;
  readonly label: string;
  readonly kpiRowId: string;
  readonly kpiKey: KpiKey;
  readonly value: number;
  readonly periodYear: number;
  readonly industrySection: string;
  readonly sizeBand: SizeBand;
};

/**
 * The approved peers of a section and band with their current KPI rows (AC-8, AC-16): every
 * `company_kpi_current` row of every approved peer, each carrying the peer's label and set. The
 * task reads it with the service client; the widened policies let a signed in user read the
 * same. Throws on a database error. Task and server component.
 */
export async function getPeerSet(
  supabase: Client,
  section: string,
  sizeBand: SizeBand,
): Promise<readonly PeerSetRow[]> {
  const { data: peers, error } = await supabase
    .from("peer_companies")
    .select("id, company_id, display_label")
    .eq("industry_section", section)
    .eq("size_band", sizeBand)
    .eq("status", "approved");
  if (error) throw queryError(error);
  const labelled = peers.flatMap((peer) =>
    peer.display_label ? [{ ...peer, display_label: peer.display_label }] : [],
  );
  if (labelled.length === 0) return [];
  const { data: rows, error: rowsError } = await supabase
    .from("company_kpi_current")
    .select("id, company_id, kpi_key, value, period_year")
    .in(
      "company_id",
      labelled.map((peer) => peer.company_id),
    );
  if (rowsError) throw queryError(rowsError);
  const byCompany = new Map(labelled.map((peer) => [peer.company_id, peer]));
  return rows.flatMap((row) => {
    const peer = row.company_id ? byCompany.get(row.company_id) : undefined;
    if (
      !peer ||
      row.id === null ||
      row.value === null ||
      row.period_year === null ||
      !isKpiKey(row.kpi_key)
    ) {
      return [];
    }
    return [
      {
        peerId: peer.id,
        companyId: peer.company_id,
        label: peer.display_label,
        kpiRowId: row.id,
        kpiKey: row.kpi_key,
        value: Number(row.value),
        periodYear: row.period_year,
        industrySection: section,
        sizeBand,
      },
    ];
  });
}

/** How many approved peers a section and band holds (AC-9's note), for the "not enough peer data" wording. Throws on a database error. Server component. */
export async function countApprovedPeers(
  supabase: Client,
  section: string | null,
  sizeBand: SizeBand,
): Promise<number> {
  if (!section) return 0;
  const { count, error } = await supabase
    .from("peer_companies")
    .select("id", { count: "exact", head: true })
    .eq("industry_section", section)
    .eq("size_band", sizeBand)
    .eq("status", "approved");
  if (error) throw queryError(error);
  return count ?? 0;
}

/** One peer the disclosure names (AC-13), resolved from the KPI rows a snapshot stored. */
export type SnapshotPeerCompany = {
  readonly label: string;
  /** False when the stored rows are no longer readable (the peer was retired since): the label still lists. */
  readonly resolved: boolean;
  readonly name: string | null;
  readonly website: string | null;
  readonly researchedAt: string | null;
  readonly sources: readonly KpiSource[];
};

/**
 * The peers a snapshot actually compared against (AC-13, AC-16): the stored `kpiRowId`s resolved
 * to their company, its legal name, the sources of those rows and the peer's `researched_at`,
 * one entry per label. A label whose rows the caller can no longer read (a retired peer) stays in
 * the list as unresolved, so the panel never lists fewer peers than the chart shows. Throws on a
 * database error. Server component.
 */
export async function loadSnapshotPeers(
  supabase: Client,
  used: ReadonlyArray<{ readonly label: string; readonly kpiRowId: string }>,
): Promise<readonly SnapshotPeerCompany[]> {
  const labels = [...new Set(used.map((entry) => entry.label))].sort();
  if (labels.length === 0) return [];
  const { data, error } = await supabase
    .from("company_kpis")
    .select(
      "id, sources, company:companies(name, legal_name, website, peer:peer_companies(researched_at))",
    )
    .in("id", [...new Set(used.map((entry) => entry.kpiRowId))]);
  if (error) throw queryError(error);
  const byRowId = new Map(data.map((row) => [row.id, row]));
  return labels.map((label) => {
    const rows = used
      .filter((entry) => entry.label === label)
      .flatMap((entry) => {
        const row = byRowId.get(entry.kpiRowId);
        return row ? [row] : [];
      });
    const first = rows[0];
    if (!first) {
      return { label, resolved: false, name: null, website: null, researchedAt: null, sources: [] };
    }
    const sources = rows.flatMap((row) => parseKpiSources(row.sources));
    const unique = [...new Map(sources.map((source) => [source.url, source])).values()];
    return {
      label,
      resolved: true,
      name: first.company.legal_name ?? first.company.name,
      website: first.company.website,
      researchedAt: first.company.peer?.researched_at ?? null,
      sources: unique,
    };
  });
}

/** The peer statuses the ops screen can move a peer to, by its current status (the state machine of spec 0012). Pure. */
export function allowedTransitions(status: PeerStatus): readonly PeerStatus[] {
  switch (status) {
    case "proposed":
      return ["approved", "rejected"];
    case "approved":
      return ["retired"];
    case "retired":
      return ["approved"];
    default:
      return [];
  }
}

/** True when the company id belongs to the house organization; the runs helper filters by it. Pure. */
export function isHouseOrganization(organizationId: string): boolean {
  return organizationId === HOUSE_ORGANIZATION_ID;
}
