import type { SupabaseClient } from "@supabase/supabase-js";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { EXPERTS_PAGE_SIZE, PHOTO_BUCKET, PHOTO_URL_TTL_SECONDS } from "./catalogue";
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
