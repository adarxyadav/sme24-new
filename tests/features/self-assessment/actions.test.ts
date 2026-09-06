// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The self assessment actions (spec 0010, AC-5, AC-6, AC-11): both refuse anyone but a client
 * with an organization claim, `saveClientKpis` checks the company, updates the existing client
 * rows by id and inserts the rest with the full row shape, answers `forbidden` on an update that
 * returns no row, `conflict` on a `23505` insert, keys the benchmark trigger by the newest
 * `updated_at` and still answers `ok` without the trigger key; `clearClientKpi` deletes the one
 * row and keys the trigger by its id. The action client, the SDK, the env and Sentry are the
 * boundaries.
 */
type Row = Record<string, unknown>;
type Op = [name: string, args: unknown[]];
type Call = { table: string; ops: Op[] };
type Answer = { data: unknown; error: null | { code?: string; message: string } };

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  env: { TRIGGER_SECRET_KEY: "tr_dev_x" } as Record<string, unknown>,
  calls: [] as Array<{ table: string; ops: Array<[string, unknown[]]> }>,
  answer: (() => ({ data: [], error: null })) as (call: {
    table: string;
    ops: Array<[string, unknown[]]>;
  }) => { data: unknown; error: null | { code?: string; message: string } },
  trigger: vi.fn<(id: string, payload: unknown, options: unknown) => Promise<{ id: string }>>(),
  createKey: vi.fn(async (key: string, options: unknown) => ({ key, options })),
  captureException: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      boundary.calls.push(call);
      const chain: Record<string | symbol, unknown> = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (value: Answer) => void) => resolve(boundary.answer(call));
            }
            return (...args: unknown[]) => {
              call.ops.push([String(prop), args]);
              return chain;
            };
          },
        },
      );
      return chain;
    },
  }),
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: boundary.trigger },
  idempotencyKeys: { create: boundary.createKey },
}));
vi.mock("@/lib/env", () => ({ serverEnv: () => boundary.env }));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));

import { clearClientKpi, saveClientKpis } from "@/features/self-assessment/actions";

const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const USER = "a0000000-0000-4000-8000-000000000001";
const LTIFR_ROW = "0f000000-0000-4000-8000-000000000002";
const T1 = "2026-09-06T10:00:00.123456+00:00";
const T2 = "2026-09-06T10:00:00.223456+00:00";

function clientClaims(): Record<string, unknown> {
  return { sub: USER, app_metadata: { role: "client", organization_id: ORG } };
}

/** The first op name of a call, which says what the statement does. */
const kind = (call: Call) => call.ops[0]?.[0] ?? "";

/** The default database: the company exists, one client row for LTIFR 2024, updates and inserts return rows. */
function defaultAnswer(overrides: Partial<Record<string, (call: Call) => Answer>> = {}) {
  return (call: Call): Answer => {
    const custom = overrides[`${call.table}:${kind(call)}`];
    if (custom) return custom(call);
    if (call.table === "companies") return { data: { id: COMPANY }, error: null };
    if (kind(call) === "select")
      return { data: [{ id: LTIFR_ROW, kpi_key: "ltifr" }], error: null };
    if (kind(call) === "update") return { data: [{ id: LTIFR_ROW, updated_at: T1 }], error: null };
    if (kind(call) === "insert") {
      const inserted = (call.ops[0]?.[1][0] ?? []) as Row[];
      const rows = inserted.map((row, index) => ({
        id: `0f000000-0000-4000-8000-00000000001${index}`,
        updated_at: T2,
        ...row,
      }));
      return { data: rows, error: null };
    }
    if (kind(call) === "delete") return { data: [{ id: LTIFR_ROW }], error: null };
    return { data: [], error: null };
  };
}

beforeEach(() => {
  boundary.claims = clientClaims();
  boundary.env = { TRIGGER_SECRET_KEY: "tr_dev_x" };
  boundary.calls = [];
  boundary.answer = defaultAnswer();
  boundary.trigger.mockReset();
  boundary.trigger.mockResolvedValue({ id: "run_1" });
  boundary.createKey.mockClear();
  boundary.captureException.mockClear();
});

const save = (values: Record<string, unknown>, periodYear = 2024) =>
  saveClientKpis(null, { companyId: COMPANY, periodYear, values });

describe("saveClientKpis (AC-5)", () => {
  it("updates the existing client row by id, inserts the rest with the full shape and keys the trigger by the newest updated_at", async () => {
    const result = await save({ ltifr: "2,9", trifr: "6.1", iso_45001_certified: "1" });
    expect(result).toEqual({
      ok: true,
      data: {
        companyId: COMPANY,
        periodYear: 2024,
        saved: ["ltifr", "trifr", "iso_45001_certified"],
        benchmarkQueued: true,
      },
    });
    const [company, existing, update, insert] = boundary.calls;
    expect(company?.table).toBe("companies");
    expect(company?.ops).toEqual([
      ["select", ["id"]],
      ["eq", ["id", COMPANY]],
      ["eq", ["organization_id", ORG]],
      ["is", ["archived_at", null]],
      ["maybeSingle", []],
    ]);
    expect(existing?.ops).toEqual([
      ["select", ["id, kpi_key"]],
      ["eq", ["company_id", COMPANY]],
      ["eq", ["period_year", 2024]],
      ["eq", ["source", "client"]],
      ["in", ["kpi_key", ["ltifr", "trifr", "iso_45001_certified"]]],
    ]);
    expect(update?.ops).toEqual([
      ["update", [{ value: 2.9 }]],
      ["eq", ["id", LTIFR_ROW]],
      ["select", ["id, updated_at"]],
    ]);
    expect(insert?.ops[0]).toEqual([
      "insert",
      [
        [
          {
            organization_id: ORG,
            company_id: COMPANY,
            kpi_key: "trifr",
            period_year: 2024,
            value: 6.1,
            source: "client",
            created_by: USER,
            confidence: null,
            sources: [],
            research_run_id: null,
            note: null,
          },
          expect.objectContaining({ kpi_key: "iso_45001_certified", value: 1 }),
        ],
      ],
    ]);
    expect(insert?.ops[1]).toEqual(["select", ["id, updated_at"]]);
    expect(boundary.calls).toHaveLength(4);
    expect(boundary.createKey).toHaveBeenCalledWith(`benchmark/kpis/${COMPANY}/${T2}`, {
      scope: "global",
    });
    expect(boundary.trigger).toHaveBeenCalledWith(
      "benchmark-company",
      { companyId: COMPANY, triggerKind: "client_edit" },
      expect.objectContaining({ idempotencyKeyTTL: "1h" }),
    );
  });

  it("skips the insert when every sent key already has a row, and the update when none has", async () => {
    await save({ ltifr: "3" });
    expect(boundary.calls.map(kind)).toEqual(["select", "select", "update"]);
    expect(boundary.createKey).toHaveBeenCalledWith(`benchmark/kpis/${COMPANY}/${T1}`, {
      scope: "global",
    });
    boundary.calls = [];
    boundary.answer = defaultAnswer({ "company_kpis:select": () => ({ data: [], error: null }) });
    await save({ ltifr: "3" });
    expect(boundary.calls.map(kind)).toEqual(["select", "select", "insert"]);
  });

  it("refuses a missing or non client claim and an invalid input before touching the database", async () => {
    boundary.claims = null;
    expect(await save({ ltifr: "1" })).toEqual({ ok: false, error: "forbidden" });
    boundary.claims = { ...clientClaims(), app_metadata: { role: "expert" } };
    expect(await save({ ltifr: "1" })).toEqual({ ok: false, error: "forbidden" });
    boundary.claims = { sub: USER, app_metadata: { role: "client" } };
    expect(await save({ ltifr: "1" })).toEqual({ ok: false, error: "forbidden" });
    boundary.claims = clientClaims();
    expect(await save({ ltifr: "2.555" })).toEqual({ ok: false, error: "validation" });
    expect(await save({})).toEqual({ ok: false, error: "validation" });
    expect(await save({ ltifr: "1" }, 2031)).toEqual({ ok: false, error: "validation" });
    expect(boundary.calls).toHaveLength(0);
  });

  it("answers not_found for a company outside the organization or archived", async () => {
    boundary.answer = defaultAnswer({ "companies:select": () => ({ data: null, error: null }) });
    expect(await save({ ltifr: "1" })).toEqual({ ok: false, error: "not_found" });
    expect(boundary.calls).toHaveLength(1);
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("answers forbidden when an update returns no row and never reaches the insert", async () => {
    boundary.answer = defaultAnswer({ "company_kpis:update": () => ({ data: [], error: null }) });
    expect(await save({ ltifr: "1", trifr: "2" })).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.calls.map(kind)).toEqual(["select", "select", "update"]);
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("answers conflict on a unique violation of the insert", async () => {
    boundary.answer = defaultAnswer({
      "company_kpis:insert": () => ({ data: null, error: { code: "23505", message: "duplicate" } }),
    });
    expect(await save({ trifr: "2" })).toEqual({ ok: false, error: "conflict" });
    expect(boundary.trigger).not.toHaveBeenCalled();
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("answers unexpected on any other database error and reports it", async () => {
    boundary.answer = defaultAnswer({
      "company_kpis:insert": () => ({ data: null, error: { code: "XX000", message: "boom" } }),
    });
    expect(await save({ trifr: "2" })).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
  });

  it("still answers ok with benchmarkQueued false when the trigger fails or the key is missing", async () => {
    boundary.trigger.mockRejectedValueOnce(new Error("offline"));
    expect(await save({ ltifr: "1" })).toEqual({
      ok: true,
      data: { companyId: COMPANY, periodYear: 2024, saved: ["ltifr"], benchmarkQueued: false },
    });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
    boundary.env = {};
    expect(await save({ ltifr: "1" })).toMatchObject({
      ok: true,
      data: { benchmarkQueued: false },
    });
    expect(boundary.trigger).toHaveBeenCalledTimes(1);
  });
});

describe("clearClientKpi (AC-6)", () => {
  const clear = () =>
    clearClientKpi(null, { companyId: COMPANY, kpiKey: "ltifr", periodYear: 2024 });

  it("deletes the one client row through the delete policy and keys the trigger by its id", async () => {
    expect(await clear()).toEqual({
      ok: true,
      data: { companyId: COMPANY, kpiKey: "ltifr", periodYear: 2024, benchmarkQueued: true },
    });
    expect(boundary.calls).toHaveLength(1);
    expect(boundary.calls[0]?.ops).toEqual([
      ["delete", []],
      ["eq", ["company_id", COMPANY]],
      ["eq", ["kpi_key", "ltifr"]],
      ["eq", ["period_year", 2024]],
      ["eq", ["source", "client"]],
      ["select", ["id"]],
    ]);
    expect(boundary.createKey).toHaveBeenCalledWith(`benchmark/kpis-clear/${LTIFR_ROW}`, {
      scope: "global",
    });
    expect(boundary.trigger).toHaveBeenCalledWith(
      "benchmark-company",
      { companyId: COMPANY, triggerKind: "client_edit" },
      expect.objectContaining({ idempotencyKeyTTL: "1h" }),
    );
  });

  it("answers not_found when no row was deleted, forbidden without a client claim, validation on a bad key", async () => {
    boundary.answer = defaultAnswer({ "company_kpis:delete": () => ({ data: [], error: null }) });
    expect(await clear()).toEqual({ ok: false, error: "not_found" });
    expect(boundary.trigger).not.toHaveBeenCalled();
    boundary.claims = { ...clientClaims(), app_metadata: { role: "ops", organization_id: ORG } };
    expect(await clear()).toEqual({ ok: false, error: "forbidden" });
    boundary.claims = clientClaims();
    expect(
      await clearClientKpi(null, { companyId: COMPANY, kpiKey: "nope", periodYear: 2024 }),
    ).toEqual({ ok: false, error: "validation" });
  });

  it("answers ok with benchmarkQueued false when the trigger fails", async () => {
    boundary.trigger.mockRejectedValueOnce(new Error("offline"));
    expect(await clear()).toMatchObject({ ok: true, data: { benchmarkQueued: false } });
  });
});
