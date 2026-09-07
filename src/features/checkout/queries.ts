import type { SupabaseClient } from "@supabase/supabase-js";
import { afterCursorFilter, decodeCursor, encodeCursor } from "@/lib/supabase/cursor";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";

/**
 * The checkout read paths (spec 0011). Every one runs under the caller's own session, so row
 * level security is the tenant boundary: another organization's order simply is not there, which
 * is why the pages answer 404 rather than 403 (a 403 would confirm the row exists).
 *
 * Queries throw, per the project's single error handling rule; the pages catch through their
 * error boundary.
 */

type Client = SupabaseClient<Database>;

export type OrderRow = Tables<"orders">;
export type InvoiceRow = Tables<"invoices">;
export type PackageRow = Tables<"packages">;
export type OrderEventRow = Tables<"order_events">;

/** How many orders one page of the list holds (spec 0011, API surface). */
export const ORDERS_PAGE_SIZE = 20;

/** An order with the invoice it may already have. */
export type OrderWithInvoice = {
  readonly order: OrderRow;
  readonly invoice: InvoiceRow | null;
};

/** One page of the order list, keyset paginated on `created_at desc, id desc`. */
export type OrderPage = {
  readonly orders: readonly OrderRow[];
  /**
   * The opaque cursor to pass for the next page, or null at the end of the list. It carries both
   * halves of the sort key, because `created_at` alone is not unique: several orders can share a
   * timestamp, and a cursor holding only the timestamp skips every row tied with it.
   */
  readonly nextCursor: string | null;
};

/** The purchasable packages in display order, priced and active. Server component or action. */
export async function listPurchasablePackages(supabase: Client): Promise<readonly PackageRow[]> {
  const { data, error } = await supabase
    .from("packages")
    .select("*")
    .not("price_rappen", "is", null)
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (error) throw queryError(error);
  return data ?? [];
}

/** One package by key, or null when it does not exist. Server component or action. */
export async function getPackage(supabase: Client, key: string): Promise<PackageRow | null> {
  const { data, error } = await supabase.from("packages").select("*").eq("key", key).maybeSingle();
  if (error) throw queryError(error);
  return data;
}

/**
 * One page of the organization's orders, newest first (AC-1). Expired orders are hidden from the
 * client (AC-6): an abandoned checkout is not something the buyer needs to see again. The cursor
 * is the opaque keyset cursor of the last row of the previous page, carrying `created_at` and
 * `id` together so orders sharing a timestamp are not skipped.
 *
 * Server component.
 */
export async function listOrders(supabase: Client, cursor?: string | null): Promise<OrderPage> {
  let query = supabase
    .from("orders")
    .select("*")
    .neq("status", "expired")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ORDERS_PAGE_SIZE + 1);
  const after = decodeCursor(cursor ?? undefined);
  if (after) query = query.or(afterCursorFilter(after));

  const { data, error } = await query;
  if (error) throw queryError(error);

  const rows = data ?? [];
  const hasMore = rows.length > ORDERS_PAGE_SIZE;
  const orders = hasMore ? rows.slice(0, ORDERS_PAGE_SIZE) : rows;
  const last = orders.at(-1);
  return {
    orders,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  };
}

/**
 * One order with its invoice, or null when the id belongs to another organization or does not
 * exist. The two cases are deliberately indistinguishable (AC-12). Server component.
 */
export async function getOrder(
  supabase: Client,
  orderId: string,
): Promise<OrderWithInvoice | null> {
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!order) return null;

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (invoiceError) throw queryError(invoiceError);

  return { order, invoice: invoice ?? null };
}

/** The history of one order, newest first. Server component. */
export async function listOrderEvents(
  supabase: Client,
  orderId: string,
): Promise<readonly OrderEventRow[]> {
  const { data, error } = await supabase
    .from("order_events")
    .select("*")
    .eq("order_id", orderId)
    .order("occurred_at", { ascending: false });
  if (error) throw queryError(error);
  return data ?? [];
}

/** The organization's companies for the checkout picker, oldest first. Server component. */
export async function listCompanies(
  supabase: Client,
): Promise<readonly Pick<Tables<"companies">, "id" | "name" | "uid">[]> {
  const { data, error } = await supabase
    .from("companies")
    .select("id, name, uid")
    .order("created_at", { ascending: true });
  if (error) throw queryError(error);
  return data ?? [];
}

/** One ops row: the order with its client, and whatever invoice it has. */
export type OpsOrderRow = {
  readonly order: OrderRow;
  readonly organizationName: string;
  readonly invoice: Pick<
    InvoiceRow,
    "id" | "number" | "pdf_path" | "pdf_failed_at" | "cancelled_at"
  > | null;
};

/**
 * Every order for ops, newest first (spec 0011, AC-9). Runs under the ops session, where the ops
 * policy grants full read; the same query as a client would run simply returns their own rows.
 * Server component, ops only.
 */
export async function listAllOrders(
  supabase: Client,
  cursor?: string | null,
): Promise<{ readonly rows: readonly OpsOrderRow[]; readonly nextCursor: string | null }> {
  let query = supabase
    .from("orders")
    .select(
      "*, organizations:organization_id(name), invoices(id, number, pdf_path, pdf_failed_at, cancelled_at)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(ORDERS_PAGE_SIZE + 1);
  const after = decodeCursor(cursor ?? undefined);
  if (after) query = query.or(afterCursorFilter(after));

  const { data, error } = await query;
  if (error) throw queryError(error);

  const all = data ?? [];
  const hasMore = all.length > ORDERS_PAGE_SIZE;
  const page = hasMore ? all.slice(0, ORDERS_PAGE_SIZE) : all;
  const rows = page.map((row) => {
    const { organizations, invoices, ...order } = row as typeof row & {
      organizations: { name: string } | null;
      invoices: OpsOrderRow["invoice"][] | OpsOrderRow["invoice"] | null;
    };
    return {
      order: order as unknown as OrderRow,
      organizationName: organizations?.name ?? "—",
      invoice: Array.isArray(invoices) ? (invoices[0] ?? null) : invoices,
    };
  });
  const last = rows.at(-1);
  return {
    rows,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.order.created_at, id: last.order.id })
        : null,
  };
}
