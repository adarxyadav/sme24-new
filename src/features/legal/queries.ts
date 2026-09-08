import type { SupabaseClient } from "@supabase/supabase-js";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  ALL_DATA_REQUEST_STATUSES,
  type DataRequestFilters,
  type DataRequestStatus,
  isOpen,
  OPEN_STATUSES,
  PAGE_SIZE,
} from "./schema";
import { termsAreCurrent } from "./terms";

type Client = SupabaseClient<Database>;

/**
 * The legal reads (spec 0015). The terms gate asks, on every signed in render, whether the
 * caller still stands on the current terms; the rest read data requests, for the subject's own card
 * and for the ops queue.
 */

/**
 * Whether the caller must re accept the terms before using a signed in page (AC-10).
 *
 * Read with the caller's own client under RLS, which limits the row to their own profile. A caller
 * with no readable profile row is treated as current: they are either signed out, in which case
 * the proxy has already turned them away, or mid sign up, and a blocking dialog over an empty
 * shell would strand them with nothing to accept against. A caller who has never accepted anything
 * is treated the same way, and for the same reason: their consent is owed to the onboarding flow
 * that is already asking for it, not to a dialog blocking the page they are trying to reach.
 *
 * A database error is treated the same way, deliberately. This gate decides whether to obstruct
 * every signed in page, so a transient read failure must fail open; the write path is what carries
 * the compliance guarantee, and `accept_terms()` is the only thing that can satisfy it. Server
 * component, called from the shared area shell.
 */
export async function readTermsStale(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("terms_version, terms_accepted_at")
    .maybeSingle();
  if (error || !data) return false;
  // Both columns, because the version alone lies. `terms_version` carries a `not null default '1'`,
  // so a profile that never accepted anything — a staff account created by the invite path, before
  // onboarding records consent — still reads as version 1. Only an acceptance makes a version mean
  // something, which is the invariant the two columns are supposed to keep.
  if (!data.terms_accepted_at) return false;
  return !termsAreCurrent(data.terms_version);
}

export type DataRequest = Tables<"data_requests">;

/** One request with the subject's name and organization, for the ops list and detail. */
export type DataRequestRow = DataRequest & {
  readonly subject: { readonly full_name: string | null } | null;
  readonly organization: { readonly name: string } | null;
};

export type DataRequestPage = {
  readonly rows: readonly DataRequestRow[];
  /** The cursor of the next page, null on the last page. */
  readonly nextCursor: string | null;
};

/** The `data_requests` columns plus the two joined names, in one PostgREST select. */
const ROW_SELECT =
  "*, subject:profiles!data_requests_requested_by_fkey(full_name), organization:organizations(name)";

/**
 * The caller's own data requests, newest first (AC-11). RLS is the boundary: the select policy is
 * `auth.uid() = requested_by`, so this reads the caller's rows and nobody else's without the query
 * naming an id at all. Unpaged on purpose — a person exercises two rights, and the open guard
 * stops the list growing without bound. Throws on a database error. Server component.
 */
export async function listMyRequests(): Promise<readonly DataRequest[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("data_requests")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw queryError(error);
  return data;
}

/**
 * The ops queue (AC-13): ordered by deadline rather than by filing date, because the thing that
 * must not be missed is the thirty day answer window, and 50 per page on the keyset cursor
 * (`created_at`, `id`). The default filter is the open queue, both `new` and `in_progress`
 * together; a named status filters to it and `all` lifts the filter. RLS limits it to the ops
 * role. Throws on a database error. Server component.
 */
export async function listDataRequests(
  supabase: Client,
  filters: DataRequestFilters,
): Promise<DataRequestPage> {
  let query = supabase
    .from("data_requests")
    .select(ROW_SELECT)
    .order("due_at", { ascending: true })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (filters.status === "open") query = query.in("status", [...OPEN_STATUSES]);
  else if (filters.status !== ALL_DATA_REQUEST_STATUSES) query = query.eq("status", filters.status);
  const cursor = decodeCursor(filters.cursor);
  if (cursor) query = query.or(afterCursorFilter(cursor));

  const { data, error } = await query;
  if (error) throw queryError(error);
  const hasMore = data.length > PAGE_SIZE;
  const rows = hasMore ? data.slice(0, PAGE_SIZE) : data;
  const last = rows[rows.length - 1];
  return {
    rows,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

/**
 * One request with the subject's name and organization for the ops detail page; null when the id
 * is not a UUID, unknown or not visible. Throws on a database error. Server component.
 */
export async function getDataRequest(supabase: Client, id: string): Promise<DataRequestRow | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase
    .from("data_requests")
    .select(ROW_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw queryError(error);
  return data;
}

/**
 * Whether a request is past its answer deadline, compared in `Europe/Zurich` (the value sourcing
 * table). `due_at` is stored as an instant, so the comparison itself is instant against instant
 * and needs no conversion; the zone matters only to the date the page renders beside it. Pure.
 */
export function isOverdue(request: Pick<DataRequest, "due_at" | "status">, now: Date): boolean {
  return isOpen(request.status as DataRequestStatus) && Date.parse(request.due_at) <= now.getTime();
}
