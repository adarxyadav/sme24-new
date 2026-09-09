// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCursor } from "@/lib/supabase/cursor";

/**
 * The legal reads (spec 0015, AC-10, AC-11, AC-13).
 *
 * Two of these carry real risk. `readTermsStale` decides whether to obstruct every signed in page,
 * so what it does when it cannot answer matters as much as what it does when it can: it fails
 * open, deliberately, because the compliance guarantee lives on the write path and a transient
 * read failure must not lock everyone out. And it reads both columns, because `terms_version`
 * carries a `not null default '1'` and so lies about a profile that never accepted anything.
 *
 * `listDataRequests` orders by deadline rather than by filing date, which is the whole reason the
 * queue exists, and its keyset page has to ask for one row more than it shows or the last page
 * never ends.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  /** What the profiles read answers. */
  profile: { data: null as Row | null, error: null as Row | null },
  /** What the data_requests read answers. */
  rows: { data: [] as Row[] | null, error: null as Row | null },
  /** What the single row read answers. */
  single: { data: null as Row | null, error: null as Row | null },
  /** Every ordering, filter and limit the list query built, in call order. */
  calls: [] as { method: string; args: unknown[] }[],
}));

/** Records the chain the queries build, so a test can assert the ordering and the filters. */
function listChain(result: { data: Row[] | Row | null; error: Row | null }) {
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      boundary.calls.push({ method, args });
      return chain;
    };
  const chain = Object.assign(Promise.resolve(result), {
    select: record("select"),
    order: record("order"),
    limit: record("limit"),
    in: record("in"),
    eq: record("eq"),
    or: record("or"),
    maybeSingle: async () => result,
  });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    from: (table: string) =>
      listChain(table === "profiles" ? boundary.profile : boundary.rows) as never,
  }),
}));

const { getDataRequest, isOverdue, listDataRequests, listMyRequests, readTermsStale } =
  await import("@/features/legal/queries");
const { CURRENT_TERMS_VERSION } = await import("@/features/legal/terms");

const REQUEST_ID = "0a000000-0000-4000-8000-000000000001";

/** A client whose select chain answers with the given rows, for the two queries that take one. */
const clientFor = (result: { data: Row[] | Row | null; error: Row | null }) =>
  ({ from: () => listChain(result) }) as never;

const argsOf = (method: string) =>
  boundary.calls.filter((call) => call.method === method).map((call) => call.args);

beforeEach(() => {
  boundary.calls = [];
  boundary.profile = { data: null, error: null };
  boundary.rows = { data: [], error: null };
  boundary.single = { data: null, error: null };
});

describe("readTermsStale (AC-10)", () => {
  it("says stale when the caller accepted an older version than this build ships", async () => {
    boundary.profile = {
      data: { terms_version: "0", terms_accepted_at: "2026-01-01T00:00:00.000Z" },
      error: null,
    };
    expect(await readTermsStale()).toBe(true);
  });

  it("says current when the caller accepted the version this build ships", async () => {
    boundary.profile = {
      data: {
        terms_version: CURRENT_TERMS_VERSION,
        terms_accepted_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    };
    expect(await readTermsStale()).toBe(false);
  });

  /**
   * The regression this column pair exists for: `terms_version` has a `not null default '1'`, so a
   * staff account created by the invite path reads as version 1 without having accepted anything.
   * Reading the version alone would call that current and skip the consent onboarding owes.
   */
  it("does not gate a profile that never accepted anything, whatever its default version says", async () => {
    boundary.profile = {
      data: { terms_version: CURRENT_TERMS_VERSION, terms_accepted_at: null },
      error: null,
    };
    expect(await readTermsStale()).toBe(false);
  });

  it("does not gate a never accepted profile carrying a stale version either", async () => {
    // Their consent is owed to the onboarding flow already asking for it, not to a dialog over an
    // empty shell they have nothing to accept against.
    boundary.profile = { data: { terms_version: "0", terms_accepted_at: null }, error: null };
    expect(await readTermsStale()).toBe(false);
  });

  it("fails open on a read error, so a transient failure never blocks every signed in page", async () => {
    boundary.profile = { data: null, error: { message: "timeout" } };
    expect(await readTermsStale()).toBe(false);
  });

  it("fails open when no profile row is readable, for a caller mid sign up", async () => {
    boundary.profile = { data: null, error: null };
    expect(await readTermsStale()).toBe(false);
  });
});

describe("listMyRequests (AC-11)", () => {
  it("reads the caller's own rows newest first, naming no id, since RLS is the boundary", async () => {
    boundary.rows = { data: [{ id: REQUEST_ID }], error: null };
    expect(await listMyRequests()).toEqual([{ id: REQUEST_ID }]);
    expect(argsOf("order")).toEqual([["created_at", { ascending: false }]]);
    expect(argsOf("eq")).toEqual([]);
  });

  it("throws on a database error, the query contract", async () => {
    boundary.rows = { data: null, error: { message: "denied", code: "42501" } };
    await expect(listMyRequests()).rejects.toThrow();
  });
});

describe("listDataRequests (AC-13)", () => {
  const row = (id: string, createdAt = "2026-09-09T08:00:00.000Z") => ({
    id,
    created_at: createdAt,
    due_at: "2026-10-09T08:00:00.000Z",
    status: "new",
  });

  it("orders by deadline first, which is the thing the queue exists to protect", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), { status: "open" });
    expect(argsOf("order")[0]).toEqual(["due_at", { ascending: true }]);
  });

  it("breaks a tied deadline on the keyset columns, so a page boundary is stable", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), { status: "open" });
    expect(argsOf("order").slice(1)).toEqual([
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
  });

  it("filters to both open statuses by default rather than to a single one", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), { status: "open" });
    expect(argsOf("in")).toEqual([["status", ["new", "in_progress"]]]);
    expect(argsOf("eq")).toEqual([]);
  });

  it("filters to one named status when ops choose it", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), { status: "fulfilled" });
    expect(argsOf("eq")).toEqual([["status", "fulfilled"]]);
    expect(argsOf("in")).toEqual([]);
  });

  it("lifts the filter entirely on all", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), { status: "all" });
    expect(argsOf("eq")).toEqual([]);
    expect(argsOf("in")).toEqual([]);
  });

  it("asks for one row more than a page, or the last page would never end", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), { status: "open" });
    expect(argsOf("limit")).toEqual([[51]]);
  });

  it("hands back a full page and a cursor when a row beyond it exists", async () => {
    const rows = Array.from({ length: 51 }, (_, index) =>
      row(`0a000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    const page = await listDataRequests(clientFor({ data: rows, error: null }), {
      status: "open",
    });
    expect(page.rows).toHaveLength(50);
    // The cursor names the last row shown, not the extra one that proved there is more.
    expect(page.nextCursor).toBe(
      encodeCursor({ createdAt: "2026-09-09T08:00:00.000Z", id: rows[49]?.id as string }),
    );
  });

  it("hands back no cursor on the last page", async () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      row(`0a000000-0000-4000-8000-${String(index).padStart(12, "0")}`),
    );
    const page = await listDataRequests(clientFor({ data: rows, error: null }), {
      status: "open",
    });
    expect(page.rows).toHaveLength(50);
    expect(page.nextCursor).toBeNull();
  });

  it("hands back no cursor on an empty list", async () => {
    const page = await listDataRequests(clientFor({ data: [], error: null }), { status: "open" });
    expect(page).toEqual({ rows: [], nextCursor: null });
  });

  it("continues after a cursor rather than starting again", async () => {
    const cursor = encodeCursor({ createdAt: "2026-09-09T08:00:00.000Z", id: REQUEST_ID });
    await listDataRequests(clientFor({ data: [], error: null }), { status: "open", cursor });
    expect(argsOf("or")).toHaveLength(1);
    expect(String(argsOf("or")[0]?.[0])).toContain(REQUEST_ID);
  });

  it("ignores a malformed cursor rather than throwing on a bookmarked URL", async () => {
    await listDataRequests(clientFor({ data: [], error: null }), {
      status: "open",
      cursor: "not-base64url!!",
    });
    expect(argsOf("or")).toEqual([]);
  });

  it("throws on a database error", async () => {
    await expect(
      listDataRequests(clientFor({ data: null, error: { message: "denied" } }), {
        status: "open",
      }),
    ).rejects.toThrow();
  });
});

describe("getDataRequest (AC-13)", () => {
  it("reads the row an ops user asked for", async () => {
    const client = clientFor({ data: { id: REQUEST_ID }, error: null });
    expect(await getDataRequest(client, REQUEST_ID)).toEqual({ id: REQUEST_ID });
  });

  it("answers null for an id that is not a UUID, without querying at all", async () => {
    // A path segment is whatever the URL bar holds, so it is checked before it reaches a filter.
    await expect(getDataRequest(clientFor({ data: null, error: null }), "../../etc")).resolves.toBe(
      null,
    );
    expect(boundary.calls).toEqual([]);
  });

  it("answers null for a well formed id nobody can see", async () => {
    expect(await getDataRequest(clientFor({ data: null, error: null }), REQUEST_ID)).toBeNull();
  });

  it("throws on a database error", async () => {
    await expect(
      getDataRequest(clientFor({ data: null, error: { message: "denied" } }), REQUEST_ID),
    ).rejects.toThrow();
  });
});

/**
 * `due_at` is stored as an instant, so the comparison is instant against instant and needs no zone
 * conversion; the zone matters only to the date rendered beside the badge.
 */
describe("isOverdue (AC-13)", () => {
  const at = (due: string, status = "new") => ({ due_at: due, status });
  const NOW = new Date("2026-10-09T08:00:00.000Z");

  it("marks an open request past its deadline", () => {
    expect(isOverdue(at("2026-10-08T08:00:00.000Z"), NOW)).toBe(true);
    expect(isOverdue(at("2026-10-08T08:00:00.000Z", "in_progress"), NOW)).toBe(true);
  });

  it("marks a request exactly at its deadline, since the window has run out", () => {
    expect(isOverdue(at("2026-10-09T08:00:00.000Z"), NOW)).toBe(true);
  });

  it("leaves a request one millisecond short of its deadline alone", () => {
    expect(isOverdue(at("2026-10-09T08:00:00.001Z"), NOW)).toBe(false);
  });

  it("never marks a closed request, however long ago its deadline was", () => {
    for (const status of ["fulfilled", "refused"] as const) {
      expect(isOverdue(at("2020-01-01T00:00:00.000Z", status), NOW), status).toBe(false);
    }
  });

  it("compares the instants, so an offset written deadline reads the same as its UTC twin", () => {
    // 10:00 in a +02:00 offset is 08:00 UTC, the exact deadline.
    expect(isOverdue(at("2026-10-09T10:00:00+02:00"), NOW)).toBe(true);
    expect(isOverdue(at("2026-10-09T10:00:00.001+02:00"), NOW)).toBe(false);
  });
});
