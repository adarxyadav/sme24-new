import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
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
