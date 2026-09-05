// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ops list queries (spec 0006, AC-9): the keyset cursor is base64url of `created_at|id` and
 * a malformed one means the first page; the list asks for one row more than the page to know
 * whether a next page exists, filters by status and template, escapes the search wildcards and
 * turns the cursor into the keyset predicate. The Supabase query builder is the boundary: a
 * recording fake that answers with the rows a test sets.
 */
const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  error: null as unknown,
  calls: [] as Array<[string, ...unknown[]]>,
}));

class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("NEXT_NOT_FOUND");
  },
}));

function fakeQuery() {
  const query = {
    select: (...args: unknown[]) => record("select", args),
    order: (...args: unknown[]) => record("order", args),
    limit: (...args: unknown[]) => record("limit", args),
    eq: (...args: unknown[]) => record("eq", args),
    ilike: (...args: unknown[]) => record("ilike", args),
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

const { decodeCursor, encodeCursor, getDelivery, listDeliveries } = await import(
  "@/features/emails/queries"
);
type Client = Parameters<typeof listDeliveries>[0];
const client = supabase as unknown as Client;

const ID = "d0000000-0000-4000-8000-000000000001";
const AT = "2026-09-05T10:00:00.000+00:00";

function row(index: number) {
  return {
    id: `d0000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    created_at: `2026-09-05T10:00:${String(index % 60).padStart(2, "0")}.000+00:00`,
    status: "sent",
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

describe("the keyset cursor (AC-9)", () => {
  it("round trips created_at and id through base64url", () => {
    const encoded = encodeCursor({ createdAt: AT, id: ID });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual({ createdAt: AT, id: ID });
  });

  it("treats a missing, malformed or tampered cursor as the first page", () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not base64url at all!")).toBeNull();
    expect(decodeCursor(Buffer.from("no separator").toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`${AT}|not-a-uuid`).toString("base64url"))).toBeNull();
    expect(decodeCursor(Buffer.from(`yesterday|${ID}`).toString("base64url"))).toBeNull();
  });
});

describe("listDeliveries (AC-9)", () => {
  it("orders newest first, asks for one row more than the page and returns no cursor on the last page", async () => {
    state.rows = Array.from({ length: 50 }, (_, index) => row(index + 1));
    const page = await listDeliveries(client, {});
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBeNull();
    expect(callsNamed("from")).toEqual([["email_deliveries"]]);
    expect(callsNamed("order")).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(callsNamed("limit")).toEqual([[51]]);
    expect(callsNamed("eq")).toEqual([]);
    expect(callsNamed("or")).toEqual([]);
  });

  it("cuts a full page plus one to the page and points the cursor at the last shown row", async () => {
    state.rows = Array.from({ length: 51 }, (_, index) => row(index + 1));
    const page = await listDeliveries(client, {});
    expect(page.rows).toHaveLength(50);
    const last = page.rows[49];
    expect(last?.id).toBe(row(50).id);
    expect(page.nextCursor).toBe(encodeCursor({ createdAt: row(50).created_at, id: row(50).id }));
  });

  it("filters by status and template and searches the recipient with escaped wildcards", async () => {
    await listDeliveries(client, { status: "failed", template: "welcome", q: "50%_off\\" });
    expect(callsNamed("eq")).toEqual([
      ["status", "failed"],
      ["template", "welcome"],
    ]);
    expect(callsNamed("ilike")).toEqual([["recipient_email", "%50\\%\\_off\\\\%"]]);
  });

  it("turns a valid cursor into the keyset predicate and ignores a broken one", async () => {
    await listDeliveries(client, { cursor: encodeCursor({ createdAt: AT, id: ID }) });
    expect(callsNamed("or")).toEqual([
      [`created_at.lt.${AT},and(created_at.eq.${AT},id.lt.${ID})`],
    ]);
    state.calls = [];
    await listDeliveries(client, { cursor: "garbage" });
    expect(callsNamed("or")).toEqual([]);
  });

  it("throws on a database error so the page's error boundary shows it", async () => {
    state.error = new Error("permission denied for table email_deliveries");
    await expect(listDeliveries(client, {})).rejects.toThrow("permission denied");
  });
});

describe("getDelivery (AC-9)", () => {
  it("returns the row for a known id", async () => {
    state.rows = [{ ...row(1), id: ID }];
    await expect(getDelivery(client, ID)).resolves.toMatchObject({ id: ID });
    expect(callsNamed("eq")).toEqual([["id", ID]]);
  });

  it("renders not found for a non uuid without touching the database", async () => {
    await expect(getDelivery(client, "1; drop table")).rejects.toThrow(NotFound);
    expect(state.calls).toEqual([]);
  });

  it("renders not found for an unknown or invisible id", async () => {
    await expect(getDelivery(client, ID)).rejects.toThrow(NotFound);
  });

  it("throws on a database error", async () => {
    state.error = new Error("connection reset");
    await expect(getDelivery(client, ID)).rejects.toThrow("connection reset");
  });
});
