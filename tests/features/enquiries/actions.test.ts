// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `updateEnquiry` (spec 0009, AC-12): ops only, parsed input, the handler columns written by a
 * first update filtered on the stored `new` status and only when the target status leaves
 * `new`, then the plain update; an unknown id answers `not_found`, a database error
 * `unavailable`. The action client, Sentry and the logger are the boundaries.
 */
type Row = Record<string, unknown>;
type Call = { payload: Row; filters: Array<[string, unknown]>; selected: boolean };

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  rows: [] as Row[],
  calls: [] as Call[],
  updateError: null as { message: string } | null,
  captureException: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: () => builder(),
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function builder() {
  const call: Call = { payload: {}, filters: [], selected: false };
  const execute = () => {
    boundary.calls.push(call);
    if (boundary.updateError) return { data: null, error: boundary.updateError };
    const matched = boundary.rows.filter((row) =>
      call.filters.every(([column, value]) => row[column] === value),
    );
    for (const row of matched) Object.assign(row, call.payload);
    return { data: matched, error: null };
  };
  const chain = {
    update: (payload: Row) => {
      call.payload = payload;
      return chain;
    },
    eq: (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return chain;
    },
    select: () => {
      call.selected = true;
      return chain;
    },
    maybeSingle: async () => {
      const result = execute();
      return { data: result.data?.[0] ?? null, error: result.error };
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject),
  };
  return chain;
}

const { updateEnquiry } = await import("@/features/enquiries/actions");

const OPS = "c0000000-0000-4000-8000-000000000001";
const ID = "e1000000-0000-4000-8000-000000000001";
const ops = { sub: OPS, app_metadata: { role: "ops" } };

beforeEach(() => {
  boundary.claims = ops;
  boundary.rows = [{ id: ID, status: "new", ops_note: null, handled_by: null, handled_at: null }];
  boundary.calls = [];
  boundary.updateError = null;
});

describe("updateEnquiry (AC-12)", () => {
  it("refuses a client, an expert and a visitor with forbidden before touching the table", async () => {
    for (const claims of [
      null,
      { sub: OPS, app_metadata: { role: "client" } },
      { sub: OPS, app_metadata: { role: "expert" } },
    ]) {
      boundary.claims = claims;
      expect(await updateEnquiry(null, { id: ID, status: "closed" })).toEqual({
        ok: false,
        error: "forbidden",
      });
    }
    expect(boundary.calls).toEqual([]);
  });

  it("answers validation on a bad status without touching the table", async () => {
    expect(await updateEnquiry(null, { id: ID, status: "archived" })).toEqual({
      ok: false,
      error: "validation",
    });
    expect(boundary.calls).toEqual([]);
  });

  it("writes the handler columns on the first move out of new, in a statement filtered on the stored status", async () => {
    const result = await updateEnquiry(null, { id: ID, status: "contacted", opsNote: "Called." });
    expect(result).toEqual({ ok: true, data: { id: ID, status: "contacted" } });
    expect(boundary.calls).toHaveLength(2);
    expect(boundary.calls[0]).toMatchObject({
      payload: {
        status: "contacted",
        ops_note: "Called.",
        handled_by: OPS,
        handled_at: expect.any(String),
      },
      filters: [
        ["id", ID],
        ["status", "new"],
      ],
    });
    expect(boundary.calls[1]).toMatchObject({
      payload: { status: "contacted", ops_note: "Called." },
      filters: [["id", ID]],
      selected: true,
    });
    expect(boundary.rows[0]).toMatchObject({ status: "contacted", handled_by: OPS });
  });

  it("keeps the first handler when a contacted row is closed", async () => {
    boundary.rows = [
      {
        id: ID,
        status: "contacted",
        ops_note: "x",
        handled_by: "someone-else",
        handled_at: "2026-09-01T00:00:00Z",
      },
    ];
    await updateEnquiry(null, { id: ID, status: "closed", opsNote: "Done." });
    expect(boundary.rows[0]).toMatchObject({
      status: "closed",
      handled_by: "someone-else",
      handled_at: "2026-09-01T00:00:00Z",
      ops_note: "Done.",
    });
  });

  it("runs only the plain update when the target status is new", async () => {
    await updateEnquiry(null, { id: ID, status: "new", opsNote: "Waiting." });
    expect(boundary.calls).toHaveLength(1);
    expect(boundary.calls[0]?.payload).toEqual({ status: "new", ops_note: "Waiting." });
    expect(boundary.rows[0]).toMatchObject({
      handled_by: null,
      handled_at: null,
      ops_note: "Waiting.",
    });
  });

  it("answers not_found for an id that matches no visible row", async () => {
    const result = await updateEnquiry(null, {
      id: "e1000000-0000-4000-8000-000000000009",
      status: "closed",
    });
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("answers unavailable and reports to Sentry on a database error", async () => {
    boundary.updateError = { message: "permission denied" };
    expect(await updateEnquiry(null, { id: ID, status: "closed" })).toEqual({
      ok: false,
      error: "unavailable",
    });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
  });
});
