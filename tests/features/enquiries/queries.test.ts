// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEnquiry, listEnquiries } from "@/features/enquiries/queries";
import { PAGE_SIZE } from "@/features/enquiries/schema";
import { encodeCursor } from "@/lib/supabase/cursor";

/**
 * The ops queries of the enquiries (spec 0009, AC-12): the list is newest first on the keyset
 * cursor, asks for one row more than the page to know whether a next page exists, filters by
 * status unless `all` lifts it, and the detail joins the sender's organization name and refuses
 * a non UUID before touching the database. The Supabase query builder is the boundary: a
 * recording fake that answers with the rows a test sets.
 */
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as unknown,
  calls: [] as Array<[string, ...unknown[]]>,
}));

function fakeQuery() {
  const query = {
    select: (...args: unknown[]) => record("select", args),
    order: (...args: unknown[]) => record("order", args),
    limit: (...args: unknown[]) => record("limit", args),
    eq: (...args: unknown[]) => record("eq", args),
    or: (...args: unknown[]) => record("or", args),
    maybeSingle: async () => ({ data: state.rows[0] ?? null, error: state.error }),
    // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable Supabase query builder
    then: (resolve: (value: { data: unknown; error: unknown }) => void) =>
      resolve(state.error ? { data: null, error: state.error } : { data: state.rows, error: null }),
  };
  function record(name: string, args: unknown[]) {
    state.calls.push([name, ...args]);
    return query;
  }
  return query;
}
const supabase = {
  from: (table: string) => {
    state.calls.push(["from", table]);
    return fakeQuery();
  },
};
type Client = Parameters<typeof listEnquiries>[0];
const client = supabase as unknown as Client;

const ID = "e0000000-0000-4000-8000-000000000001";
const AT = "2026-09-06T08:30:00.000+00:00";

function row(index: number) {
  return {
    id: `e0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    created_at: `2026-09-06T08:30:${String(index % 60).padStart(2, "0")}.000+00:00`,
    status: "new",
    topic: "retainer",
    company_name: `Firma ${index}`,
  };
}

function callsNamed(name: string) {
  return state.calls.filter(([called]) => called === name).map(([, ...args]) => args);
}

beforeEach(() => {
  state.rows = [];
  state.error = null;
  state.calls = [];
});

describe("listEnquiries (AC-12)", () => {
  it("orders newest first, filters the default new status and asks for one row more than the page", async () => {
    state.rows = Array.from({ length: 3 }, (_, index) => row(index + 1));
    const page = await listEnquiries(client, { status: "new" });
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
    expect(callsNamed("from")).toEqual([["enquiries"]]);
    expect(callsNamed("order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsNamed("limit")).toEqual([[PAGE_SIZE + 1]]);
    expect(callsNamed("eq")).toEqual([["status", "new"]]);
    expect(callsNamed("or")).toEqual([]);
  });

  it("lifts the status filter for all and keeps it for contacted and closed", async () => {
    await listEnquiries(client, { status: "all" });
    expect(callsNamed("eq")).toEqual([]);
    state.calls = [];
    await listEnquiries(client, { status: "closed" });
    expect(callsNamed("eq")).toEqual([["status", "closed"]]);
  });

  it("cuts a full page plus one to the page and points the cursor at the last shown row", async () => {
    state.rows = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => row(index + 1));
    const page = await listEnquiries(client, { status: "new" });
    expect(page.rows).toHaveLength(PAGE_SIZE);
    const last = row(PAGE_SIZE);
    expect(page.rows[PAGE_SIZE - 1]?.id).toBe(last.id);
    expect(page.nextCursor).toBe(encodeCursor({ createdAt: last.created_at, id: last.id }));
  });

  it("turns a valid cursor into the keyset predicate and ignores a broken one", async () => {
    await listEnquiries(client, {
      status: "new",
      cursor: encodeCursor({ createdAt: AT, id: ID }),
    });
    expect(callsNamed("or")).toEqual([
      [`created_at.lt.${AT},and(created_at.eq.${AT},id.lt.${ID})`],
    ]);
    state.calls = [];
    await listEnquiries(client, { status: "new", cursor: "garbage" });
    expect(callsNamed("or")).toEqual([]);
  });

  it("throws on a database error so the page's error boundary shows it", async () => {
    state.error = new Error("permission denied for table enquiries");
    await expect(listEnquiries(client, { status: "new" })).rejects.toThrow("permission denied");
  });
});

describe("getEnquiry (AC-12)", () => {
  it("returns the row with the organization name joined for a known id", async () => {
    state.rows = [{ ...row(1), id: ID, organization: { name: "Musterfirma AG" } }];
    await expect(getEnquiry(client, ID)).resolves.toMatchObject({
      id: ID,
      organization: { name: "Musterfirma AG" },
    });
    expect(callsNamed("select")).toEqual([["*, organization:organizations(name)"]]);
    expect(callsNamed("eq")).toEqual([["id", ID]]);
  });

  it("answers null for a non UUID without touching the database", async () => {
    await expect(getEnquiry(client, "1; drop table enquiries")).resolves.toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("answers null for an unknown or invisible id", async () => {
    await expect(getEnquiry(client, ID)).resolves.toBeNull();
  });

  it("throws on a database error", async () => {
    state.error = new Error("connection reset");
    await expect(getEnquiry(client, ID)).rejects.toThrow("connection reset");
  });
});
