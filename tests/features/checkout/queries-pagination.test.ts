// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAllOrders, listOrders, ORDERS_PAGE_SIZE } from "@/features/checkout/queries";
import { afterCursorFilter, decodeCursor, encodeCursor } from "@/lib/supabase/cursor";

/**
 * Keyset pagination of the two order lists (spec 0011, AC-1 and AC-9).
 *
 * The regression these lock in: `created_at` alone is not unique. Several orders can share one
 * timestamp, and a cursor carrying only the timestamp asks the next page for
 * `created_at < cursor`, which skips every row tied with it. With a full page of tied rows the
 * next page came back empty while the list still offered a "Next" link, so those orders were
 * unreachable in the UI. The cursor therefore carries `created_at` and `id` together and the
 * continuation uses the `or` keyset filter.
 */

const TIED_AT = "2030-01-01T12:00:00.000Z";

/** A stub of the PostgREST builder, recording the filters the query put on it. */
function stubClient(rows: readonly Record<string, unknown>[]) {
  const calls: { or: string[]; lt: [string, unknown][] } = { or: [], lt: [] };
  const builder: Record<string, unknown> = {
    select: () => builder,
    neq: () => builder,
    order: () => builder,
    limit: () => builder,
    or: (filter: string) => {
      calls.or.push(filter);
      return builder;
    },
    lt: (column: string, value: unknown) => {
      calls.lt.push([column, value]);
      return builder;
    },
    // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable Supabase query builder
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  return { supabase: { from: () => builder } as never, calls };
}

/** `ORDERS_PAGE_SIZE + 1` orders that all share one `created_at`, so the tie spans the boundary. */
function tiedOrders() {
  return Array.from({ length: ORDERS_PAGE_SIZE + 1 }, (_, index) => ({
    id: `0e000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    created_at: TIED_AT,
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listOrders keyset pagination", () => {
  it("returns a cursor carrying the id as well as the timestamp when the page boundary is tied", async () => {
    const { supabase } = stubClient(tiedOrders());

    const page = await listOrders(supabase);

    expect(page.orders).toHaveLength(ORDERS_PAGE_SIZE);
    expect(page.nextCursor).not.toBeNull();

    // The cursor must decode to both halves of the sort key, not the bare timestamp.
    const decoded = decodeCursor(page.nextCursor ?? undefined);
    expect(decoded).toEqual({
      createdAt: TIED_AT,
      id: page.orders[ORDERS_PAGE_SIZE - 1]?.id,
    });
    // The bare timestamp would decode to nothing, which is what the bug shipped.
    expect(page.nextCursor).not.toBe(TIED_AT);
  });

  it("continues a tied page with the or keyset filter, never a strict created_at comparison", async () => {
    const cursor = encodeCursor({
      createdAt: TIED_AT,
      id: "0e000000-0000-4000-8000-000000000020",
    });
    const { supabase, calls } = stubClient([]);

    await listOrders(supabase, cursor);

    // A strict `created_at < TIED_AT` is exactly what skipped the tied rows.
    expect(calls.lt).toHaveLength(0);
    expect(calls.or).toEqual([
      afterCursorFilter({ createdAt: TIED_AT, id: "0e000000-0000-4000-8000-000000000020" }),
    ]);
    // The filter keeps the rows tied on the timestamp whose id sorts after the cursor.
    expect(calls.or[0]).toContain(`and(created_at.eq.${TIED_AT},id.lt.`);
  });

  it("ignores a malformed cursor and serves the first page rather than throwing", async () => {
    const { supabase, calls } = stubClient([]);

    await expect(listOrders(supabase, "not-a-cursor")).resolves.toEqual({
      orders: [],
      nextCursor: null,
    });
    expect(calls.or).toHaveLength(0);
    expect(calls.lt).toHaveLength(0);
  });
});

describe("listAllOrders keyset pagination", () => {
  it("returns a composite cursor for the ops list too", async () => {
    const { supabase } = stubClient(
      tiedOrders().map((order) => ({ ...order, organizations: null, invoices: null })),
    );

    const page = await listAllOrders(supabase);

    expect(page.rows).toHaveLength(ORDERS_PAGE_SIZE);
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({
      createdAt: TIED_AT,
      id: page.rows[ORDERS_PAGE_SIZE - 1]?.order.id,
    });
  });

  it("continues the ops list with the or keyset filter", async () => {
    const cursor = encodeCursor({
      createdAt: TIED_AT,
      id: "0e000000-0000-4000-8000-000000000020",
    });
    const { supabase, calls } = stubClient([]);

    await listAllOrders(supabase, cursor);

    expect(calls.lt).toHaveLength(0);
    expect(calls.or).toHaveLength(1);
  });
});
