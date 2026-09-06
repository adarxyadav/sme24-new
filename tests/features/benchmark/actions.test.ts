// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `updateCompanyFacts` (spec 0008, AC-6, AC-11): refuses anyone but a client with an organization
 * claim, parses with the feature schema, updates only the given columns keyed by the company and
 * the caller's organization, answers `not_found` on zero rows, triggers `benchmark-company` under
 * `benchmark/edit/<companyId>/<updated_at>` with a one hour TTL, and still answers `ok` with
 * `benchmarkQueued` false when the trigger fails. The action client, the SDK, the env and Sentry
 * are the boundaries.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  env: { TRIGGER_SECRET_KEY: "tr_dev_x" } as Record<string, unknown>,
  updated: [] as Row[],
  error: null as null | { code?: string; message: string },
  calls: [] as Array<{ payload: Row; filters: Array<[string, string, unknown]> }>,
  trigger: vi.fn<(id: string, payload: unknown, options: unknown) => Promise<{ id: string }>>(),
  createKey: vi.fn(async (key: string, options: unknown) => ({ key, options })),
  captureException: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: () => {
      const call = { payload: {} as Row, filters: [] as Array<[string, string, unknown]> };
      const chain = {
        update: (payload: Row) => {
          call.payload = payload;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          call.filters.push([column, "eq", value]);
          return chain;
        },
        is: (column: string, value: unknown) => {
          call.filters.push([column, "is", value]);
          return chain;
        },
        select: async () => {
          boundary.calls.push(call);
          return boundary.error
            ? { data: null, error: boundary.error }
            : { data: boundary.updated, error: null };
        },
      };
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

import { updateCompanyFacts } from "@/features/benchmark/actions";

const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const UPDATED_AT = "2026-09-06T10:00:00.123456+00:00";

function clientClaims(): Record<string, unknown> {
  return {
    sub: "a0000000-0000-4000-8000-000000000001",
    app_metadata: { role: "client", organization_id: ORG },
  };
}

beforeEach(() => {
  boundary.claims = clientClaims();
  boundary.env = { TRIGGER_SECRET_KEY: "tr_dev_x" };
  boundary.updated = [{ id: COMPANY, updated_at: UPDATED_AT }];
  boundary.error = null;
  boundary.calls = [];
  boundary.trigger.mockResolvedValue({ id: "run_1" });
});

describe("updateCompanyFacts", () => {
  it("updates only the given columns keyed by company and organization and queues the benchmark", async () => {
    const result = await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: "500" });
    expect(result).toEqual({ ok: true, data: { companyId: COMPANY, benchmarkQueued: true } });
    expect(boundary.calls[0]?.payload).toEqual({ employees_count: 500 });
    expect(boundary.calls[0]?.filters).toEqual([
      ["id", "eq", COMPANY],
      ["organization_id", "eq", ORG],
      ["archived_at", "is", null],
    ]);
    expect(boundary.createKey).toHaveBeenCalledWith(`benchmark/edit/${COMPANY}/${UPDATED_AT}`, {
      scope: "global",
    });
    expect(boundary.trigger).toHaveBeenCalledWith(
      "benchmark-company",
      { companyId: COMPANY, triggerKind: "client_edit" },
      expect.objectContaining({ idempotencyKeyTTL: "1h" }),
    );
  });

  it("writes both columns when both are given", async () => {
    await updateCompanyFacts(null, { companyId: COMPANY, industryCode: "62", employeesCount: 12 });
    expect(boundary.calls[0]?.payload).toEqual({ industry_code: "62", employees_count: 12 });
  });

  it("refuses a missing client claim and an invalid input", async () => {
    boundary.claims = null;
    expect(await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: 5 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    boundary.claims = { ...clientClaims(), app_metadata: { role: "ops" } };
    expect(await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: 5 })).toEqual({
      ok: false,
      error: "forbidden",
    });
    boundary.claims = clientClaims();
    expect(await updateCompanyFacts(null, { companyId: COMPANY })).toEqual({
      ok: false,
      error: "validation",
    });
    expect(boundary.calls).toHaveLength(0);
  });

  it("answers not_found when the policy filtered every row", async () => {
    boundary.updated = [];
    expect(await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: 5 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("answers unexpected on a database error and reports it", async () => {
    boundary.error = { code: "XX000", message: "boom" };
    expect(await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: 5 })).toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.captureException).toHaveBeenCalled();
  });

  it("still answers ok with benchmarkQueued false when the trigger fails or the key is missing", async () => {
    boundary.trigger.mockRejectedValueOnce(new Error("offline"));
    expect(await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: 5 })).toEqual({
      ok: true,
      data: { companyId: COMPANY, benchmarkQueued: false },
    });
    boundary.env = {};
    expect(await updateCompanyFacts(null, { companyId: COMPANY, employeesCount: 5 })).toEqual({
      ok: true,
      data: { companyId: COMPANY, benchmarkQueued: false },
    });
  });
});
