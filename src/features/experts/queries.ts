import type { SupabaseClient } from "@supabase/supabase-js";
import { type CompanyDashboard, getCompanyDashboard } from "@/features/research/queries";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import {
  EXPERTS_PAGE_SIZE,
  INDUSTRY_CODES,
  PHOTO_BUCKET,
  PHOTO_URL_TTL_SECONDS,
} from "./catalogue";
import { ALL_STATUSES, type ExpertFilters } from "./schema";

/**
 * The reads of the expert feature (spec 0013). Queries throw on a database error, per the project's
 * one error handling rule; the typed result shape belongs to the actions. RLS is what limits every
 * one of these to the rows the caller may see, so each runs with the caller's own client and none
 * of them takes a role as an argument.
 */

type Client = SupabaseClient<Database>;

export type ExpertProfile = Tables<"expert_profiles">;

/** One row of the ops list: the profile, the person's name and how many clients they hold now. */
export type ExpertListRow = ExpertProfile & {
  readonly fullName: string | null;
  readonly activeAssignments: number;
};

export type ExpertPage = {
  readonly rows: readonly ExpertListRow[];
  /** The cursor of the next page, null on the last page. */
  readonly nextCursor: string | null;
};

/**
 * A short lived signed URL for a photo in the private bucket (AC-6), or null when there is no photo
 * or the caller may not read it. Minted per render with the caller's own client, so the bucket
 * policy decides for each viewer rather than the application deciding once. Server components.
 */
export async function photoUrl(supabase: Client, photoPath: string | null): Promise<string | null> {
  if (!photoPath) return null;
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrl(photoPath, PHOTO_URL_TTL_SECONDS);
  // A caller the bucket policy hides the object from is not an error: they simply see the initials
  // avatar instead, which is the same thing an expert without a photo shows.
  if (error) return null;
  return data?.signedUrl ?? null;
}

/**
 * The ops list of experts (AC-7): newest invite first, 50 per page on the keyset cursor
 * (`invited_at`, `expert_id`), filtered by status. RLS limits it to ops. Throws. Server component.
 */
export async function listExperts(supabase: Client, filters: ExpertFilters): Promise<ExpertPage> {
  let query = supabase
    .from("expert_profiles")
    .select("*, profiles!expert_profiles_expert_id_fkey(full_name)")
    .order("invited_at", { ascending: false })
    .order("expert_id", { ascending: false })
    .limit(EXPERTS_PAGE_SIZE + 1);
  if (filters.status !== ALL_STATUSES) query = query.eq("status", filters.status);
  const cursor = decodeCursor(filters.cursor);
  // The keyset is (invited_at, expert_id) rather than (created_at, id), so the shared filter
  // helper's column names are rewritten here.
  if (cursor) {
    query = query.or(
      afterCursorFilter(cursor)
        .replaceAll("created_at", "invited_at")
        .replaceAll("id.lt", "expert_id.lt"),
    );
  }

  const { data, error } = await query;
  if (error) throw queryError(error);

  const all = data ?? [];
  const hasMore = all.length > EXPERTS_PAGE_SIZE;
  const page = hasMore ? all.slice(0, EXPERTS_PAGE_SIZE) : all;
  const ids = page.map((row) => row.expert_id);
  const counts = await activeAssignmentCounts(supabase, ids);

  const rows = page.map((row) => {
    const { profiles, ...profile } = row as typeof row & {
      profiles: { full_name: string | null } | null;
    };
    return {
      ...(profile as ExpertProfile),
      fullName: profiles?.full_name ?? null,
      activeAssignments: counts.get(profile.expert_id) ?? 0,
    };
  });
  const last = rows.at(-1);
  return {
    rows,
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.invited_at, id: last.expert_id }) : null,
  };
}

/**
 * How many active assignments each of these experts holds, as one query rather than one per row.
 * An expert with none is simply absent from the map. Throws. Server component.
 */
async function activeAssignmentCounts(
  supabase: Client,
  expertIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (expertIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from("expert_assignments")
    .select("expert_id")
    .in("expert_id", [...expertIds])
    .eq("status", "active");
  if (error) throw queryError(error);
  return (data ?? []).reduce((counts, row) => {
    counts.set(row.expert_id, (counts.get(row.expert_id) ?? 0) + 1);
    return counts;
  }, new Map<string, number>());
}

export type ExpertAssignmentRow = Tables<"expert_assignments"> & {
  readonly organizationName: string;
};

export type ExpertAdminPage = {
  readonly profile: ExpertProfile;
  readonly fullName: string | null;
  readonly photoUrl: string | null;
  readonly notes: string;
  readonly assignments: readonly ExpertAssignmentRow[];
};

/**
 * Everything the ops expert page shows (AC-7): the profile, the person's name, a signed photo URL,
 * the ops notes and every assignment, active first. Throws `not_found` when the id is unknown or
 * RLS hides it. Server component, ops.
 */
export async function getExpertAdminPage(
  supabase: Client,
  expertId: string,
): Promise<ExpertAdminPage | null> {
  if (!isUuid(expertId)) return null;

  const [profileResult, notesResult, assignmentsResult] = await Promise.all([
    supabase
      .from("expert_profiles")
      .select("*, profiles!expert_profiles_expert_id_fkey(full_name)")
      .eq("expert_id", expertId)
      .maybeSingle(),
    supabase.from("expert_ops_notes").select("notes").eq("expert_id", expertId).maybeSingle(),
    supabase
      .from("expert_assignments")
      .select("*, organizations(name)")
      .eq("expert_id", expertId)
      .order("status", { ascending: true })
      .order("started_at", { ascending: false }),
  ]);

  if (profileResult.error) throw queryError(profileResult.error);
  if (!profileResult.data) return null;
  if (notesResult.error) throw queryError(notesResult.error);
  if (assignmentsResult.error) throw queryError(assignmentsResult.error);

  const { profiles, ...profile } = profileResult.data as typeof profileResult.data & {
    profiles: { full_name: string | null } | null;
  };

  return {
    profile: profile as ExpertProfile,
    fullName: profiles?.full_name ?? null,
    photoUrl: await photoUrl(supabase, (profile as ExpertProfile).photo_path),
    notes: notesResult.data?.notes ?? "",
    assignments: (assignmentsResult.data ?? []).map((row) => {
      const { organizations, ...assignment } = row as typeof row & {
        organizations: { name: string } | null;
      };
      return {
        ...(assignment as Tables<"expert_assignments">),
        organizationName: organizations?.name ?? "—",
      };
    }),
  };
}

/** The caller's own expert profile row, or null when they have none. Throws. Server component. */
export async function getMyExpertProfile(supabase: Client): Promise<ExpertProfile | null> {
  const { data, error } = await supabase.from("expert_profiles").select("*").maybeSingle();
  if (error) throw queryError(error);
  return data;
}

export type OrganizationOption = {
  readonly id: string;
  readonly name: string;
  readonly companyName: string | null;
};

/**
 * The organizations the ops assign combobox offers (AC-9): up to 20 matches on the organization
 * name, each with its first company for recognition. RLS limits it to ops. Throws. Server component.
 */
export async function listOrganizationsForAssignment(
  supabase: Client,
  search: string,
): Promise<readonly OrganizationOption[]> {
  const term = search.trim().slice(0, 100);
  let query = supabase
    .from("organizations")
    .select("id, name, companies(name, created_at)")
    .order("name", { ascending: true })
    .limit(20);
  // PostgREST treats a comma and a parenthesis in `ilike` as filter syntax, so a name carrying one
  // would break the query rather than simply matching nothing.
  if (term) query = query.ilike("name", `%${term.replaceAll(",", " ").replaceAll(/[()]/g, " ")}%`);

  const { data, error } = await query;
  if (error) throw queryError(error);

  return (data ?? []).map((row) => {
    const companies = (row.companies ?? []) as { name: string; created_at: string }[];
    // One company per organization until feature 22; the oldest is the organization's own.
    const first = [...companies].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return { id: row.id, name: row.name, companyName: first?.name ?? null };
  });
}

export type AssignmentClient = {
  readonly assignmentId: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly startedAt: string;
  /** The organization's first company, absent while the client has not run a lookup yet. */
  readonly companyName: string | null;
  readonly canton: string | null;
  /** The NOGA section letter of `companies.industry_code`, the key of an `industries` label. */
  readonly industrySection: string | null;
};

/**
 * The client organizations the calling expert holds now (AC-11), newest assignment first. RLS is
 * the boundary: the expert's own select policy on `expert_assignments` returns their rows only,
 * and the organization and company join through the assigned expert read policies. Throws.
 * Server component.
 */
export async function listMyAssignments(supabase: Client): Promise<readonly AssignmentClient[]> {
  const { data, error } = await supabase
    .from("expert_assignments")
    .select(
      "id, organization_id, started_at, organizations(name, companies(name, canton, industry_code, created_at, archived_at))",
    )
    .eq("status", "active")
    .order("started_at", { ascending: false });
  if (error) throw queryError(error);

  return (data ?? []).map((row) => {
    const organization = row.organizations as {
      name: string;
      companies: {
        name: string;
        canton: string | null;
        industry_code: string | null;
        created_at: string;
        archived_at: string | null;
      }[];
    } | null;
    // One company per organization until feature 22; the oldest live one is the organization's own,
    // the same rule the ops picker and the client dashboard use.
    const company = [...(organization?.companies ?? [])]
      .filter((entry) => entry.archived_at === null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    return {
      assignmentId: row.id,
      organizationId: row.organization_id,
      organizationName: organization?.name ?? "—",
      startedAt: row.started_at,
      companyName: company?.name ?? null,
      canton: company?.canton ?? null,
      industrySection: industrySection(company?.industry_code ?? null),
    };
  });
}

/**
 * The NOGA section letter a full `industry_code` belongs to, which is what the expert catalogue
 * keys its industry labels by; null when the code is absent or does not start with a section
 * letter. Pure, runs anywhere.
 */
export function industrySection(industryCode: string | null): string | null {
  const first = industryCode?.trim().charAt(0).toUpperCase();
  return first && (INDUSTRY_CODES as readonly string[]).includes(first) ? first : null;
}

export type OrganizationContact = {
  readonly userId: string;
  readonly fullName: string | null;
  readonly email: string;
  readonly role: string;
};

export type AssignedClient = {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly dashboard: CompanyDashboard;
  readonly contacts: readonly OrganizationContact[];
};

/**
 * Everything the expert's read only client page shows (AC-11): the same dashboard the client sees,
 * read under the assigned expert policies rather than a copy of the query, plus the organization's
 * members from `assigned_organization_contacts`.
 *
 * Returns null for an organization the caller is not assigned to, whether the policies hid the
 * organization row or the function raised `not_assigned`: one answer for the one case, which the
 * page turns into `notFound()`. Throws on anything else. Server component.
 */
export async function getAssignedClient(
  supabase: Client,
  organizationId: string,
): Promise<AssignedClient | null> {
  if (!isUuid(organizationId)) return null;

  const { data: organization, error } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!organization) return null;

  const [dashboard, contacts] = await Promise.all([
    getCompanyDashboard(supabase, organizationId),
    supabase.rpc("assigned_organization_contacts", { org: organizationId }),
  ]);

  // `not_assigned` is the function refusing a caller without an active assignment; every other
  // error is real and belongs to the caller of this query.
  if (contacts.error) {
    if (contacts.error.message.includes("not_assigned")) return null;
    throw queryError(contacts.error);
  }

  return {
    organizationId,
    organizationName: organization.name,
    dashboard,
    contacts: (contacts.data ?? []).map((row) => ({
      userId: row.user_id,
      fullName: row.full_name,
      email: row.email,
      role: row.role,
    })),
  };
}

export type AssignedExpertSummary = {
  readonly assignmentId: string;
  readonly expertId: string;
  readonly fullName: string | null;
  readonly headline: string | null;
  readonly bio: string | null;
  readonly competencies: readonly string[];
  readonly industries: readonly string[];
  readonly standards: readonly string[];
  readonly languages: readonly string[];
  readonly startedAt: string;
  readonly photoUrl: string | null;
};

/**
 * The experts currently assigned to one organization, for the client's "Your expert" card (AC-12).
 * Reads `assigned_expert_summaries`, whose own where clause is the access boundary (the view is a
 * definer view), so this query adds no filter of its own beyond the organization it was asked for.
 * Every row's photo becomes a signed URL the caller's own bucket policy allows. Throws.
 * Server component.
 */
export async function listAssignedExperts(
  supabase: Client,
  organizationId: string,
): Promise<readonly AssignedExpertSummary[]> {
  if (!isUuid(organizationId)) return [];
  const { data, error } = await supabase
    .from("assigned_expert_summaries")
    .select("*")
    .eq("organization_id", organizationId)
    .order("started_at", { ascending: false });
  if (error) throw queryError(error);

  return Promise.all(
    (data ?? []).map(async (row) => ({
      assignmentId: row.assignment_id ?? "",
      expertId: row.expert_id ?? "",
      fullName: row.full_name,
      headline: row.headline,
      bio: row.bio,
      competencies: row.competencies ?? [],
      industries: row.industries ?? [],
      standards: row.standards ?? [],
      languages: row.languages ?? [],
      startedAt: row.started_at ?? "",
      photoUrl: await photoUrl(supabase, row.photo_path),
    })),
  );
}
