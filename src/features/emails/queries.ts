import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { afterCursorFilter, decodeCursor, encodeCursor, isUuid } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { type DeliveryFilters, PAGE_SIZE } from "./schema";

// The cursor helpers moved to `src/lib/supabase/cursor.ts` (shared with the enquiries list, spec 0009).
export { type Cursor, decodeCursor, encodeCursor } from "@/lib/supabase/cursor";

type Client = SupabaseClient<Database>;

export type Delivery = Tables<"email_deliveries">;

export type DeliveryPage = {
  readonly rows: readonly Delivery[];
  /** The cursor of the next page, null on the last page. */
  readonly nextCursor: string | null;
};

/**
 * The ops list of deliveries (spec 0006, AC-9): newest first, 50 per page on a keyset cursor
 * (`created_at`, `id`), filtered by status and template, searched on the recipient address. RLS
 * limits it to the ops role. Throws on a database error. Server component.
 */
export async function listDeliveries(
  supabase: Client,
  filters: DeliveryFilters,
): Promise<DeliveryPage> {
  let query = supabase
    .from("email_deliveries")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.template) query = query.eq("template", filters.template);
  if (filters.q) query = query.ilike("recipient_email", `%${escapeLike(filters.q)}%`);
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

/** One delivery for the detail page; an unknown or invisible id renders the not found page. Server component. */
export async function getDelivery(supabase: Client, id: string): Promise<Delivery> {
  if (!isUuid(id)) notFound();
  const { data, error } = await supabase
    .from("email_deliveries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!data) notFound();
  return data;
}

/** The `ilike` wildcards, so a search for `_` or `%` means those characters. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
