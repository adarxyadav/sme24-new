import type { SupabaseClient } from "@supabase/supabase-js";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { ALL_STATUSES, type EnquiryFilters, PAGE_SIZE } from "./schema";

type Client = SupabaseClient<Database>;

export type Enquiry = Tables<"enquiries">;

/** One enquiry with the sender's organization name when the row links to one. */
export type EnquiryDetail = Enquiry & {
  readonly organization: { readonly name: string } | null;
};

export type EnquiryPage = {
  readonly rows: readonly Enquiry[];
  /** The cursor of the next page, null on the last page. */
  readonly nextCursor: string | null;
};

/**
 * The ops list of enquiries (spec 0009, AC-12): newest first, 50 per page on the keyset cursor
 * (`created_at`, `id`), filtered by status (`all` lifts the filter). RLS limits it to the ops
 * role. Throws on a database error. Server component.
 */
export async function listEnquiries(
  supabase: Client,
  filters: EnquiryFilters,
): Promise<EnquiryPage> {
  let query = supabase
    .from("enquiries")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (filters.status !== ALL_STATUSES) query = query.eq("status", filters.status);
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
 * One enquiry with the sender's organization name for the detail page (AC-12); null when the id
 * is not a UUID, unknown or not visible. Throws on a database error. Server component.
 */
export async function getEnquiry(supabase: Client, id: string): Promise<EnquiryDetail | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await supabase
    .from("enquiries")
    .select("*, organization:organizations(name)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw queryError(error);
  return data;
}
