import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { type DeliveryFilters, PAGE_SIZE } from "./schema";

type Client = SupabaseClient<Database>;

export type Delivery = Tables<"email_deliveries">;

export type DeliveryPage = {
  readonly rows: readonly Delivery[];
  /** The cursor of the next page, null on the last page. */
  readonly nextCursor: string | null;
};

export type Cursor = { readonly createdAt: string; readonly id: string };

/** Encodes the keyset cursor `created_at|id` as base64url (AC-9). Pure, server only. */
export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt}|${cursor.id}`, "utf8").toString("base64url");
}

/** Decodes a cursor; a malformed value gives null (the first page). Pure, server only. */
export function decodeCursor(value: string | undefined): Cursor | null {
  if (!value) return null;
  const decoded = Buffer.from(value, "base64url").toString("utf8");
  const separator = decoded.lastIndexOf("|");
  if (separator <= 0) return null;
  const createdAt = decoded.slice(0, separator);
  const id = decoded.slice(separator + 1);
  if (!UUID_PATTERN.test(id) || Number.isNaN(Date.parse(createdAt))) return null;
  return { createdAt, id };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  if (cursor) {
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  }

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
  if (!UUID_PATTERN.test(id)) notFound();
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
