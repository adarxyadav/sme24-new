// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIME_ZONE } from "@/i18n/formats";

/**
 * The weekly retention task of the enquiries (spec 0009, AC-13): Mondays at 03:00 Zurich time
 * it nulls `ip_hash` on rows older than 30 days, deletes closed rows handled more than 12 months
 * ago, logs both counts and throws on a database error. The SDK, the env and the service
 * client are the boundaries.
 */
type Call = {
  op: string;
  payload?: unknown;
  options: unknown;
  filters: Array<[string, string, unknown]>;
};

const boundary = vi.hoisted(() => ({
  counts: { update: 4, delete: 2 } as Record<string, number | null>,
  errors: {} as Record<string, unknown>,
  calls: [] as Call[],
  info: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  schedules: { task: (options: unknown) => options },
  logger: { info: boundary.info, warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({ SUPABASE_SECRET_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: (table: string) => builder(table) }),
}));

function builder(table: string) {
  const call: Call = { op: "", options: undefined, filters: [] };
  const finish = async () => {
    boundary.calls.push({ ...call, op: `${table}.${call.op}` });
    return { count: boundary.counts[call.op] ?? null, error: boundary.errors[call.op] ?? null };
  };
  const chain = {
    update: (payload: unknown, options: unknown) => {
      call.op = "update";
      call.payload = payload;
      call.options = options;
      return chain;
    },
    delete: (options: unknown) => {
      call.op = "delete";
      call.options = options;
      return chain;
    },
    not: (column: string, operator: string, value: unknown) => {
      call.filters.push([column, `not.${operator}`, value]);
      return chain;
    },
    eq: (column: string, value: unknown) => {
      call.filters.push([column, "eq", value]);
      return chain;
    },
    lt: (column: string, value: unknown) => {
      call.filters.push([column, "lt", value]);
      return chain;
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      finish().then(resolve, reject),
  };
  return chain;
}

const { purgeEnquiries, IP_HASH_RETENTION_DAYS, CLOSED_RETENTION_DAYS } = await import(
  "@/trigger/purge-enquiries"
);
const task = purgeEnquiries as unknown as {
  id: string;
  cron: unknown;
  run: () => Promise<{ hashesCleared: number; deleted: number }>;
};

/** Sunday 6 September 2026, 03:00 UTC: 30 days earlier is 7 August, 365 days earlier is 6 September 2025. */
const AT = new Date("2026-09-06T03:00:00Z");

beforeEach(() => {
  boundary.counts = { update: 4, delete: 2 };
  boundary.errors = {};
  boundary.calls = [];
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("purge-enquiries (AC-13)", () => {
  it("is scheduled weekly on Monday 03:00 in Zurich time with the two retention constants", () => {
    expect(task.id).toBe("purge-enquiries");
    expect(task.cron).toEqual({ pattern: "0 3 * * 1", timezone: TIME_ZONE });
    expect(IP_HASH_RETENTION_DAYS).toBe(30);
    expect(CLOSED_RETENTION_DAYS).toBe(365);
  });

  it("nulls the address hash past 30 days and deletes closed rows handled more than a year ago, logging both", async () => {
    await expect(task.run()).resolves.toEqual({ hashesCleared: 4, deleted: 2 });
    expect(boundary.calls).toEqual([
      {
        op: "enquiries.update",
        payload: { ip_hash: null },
        options: { count: "exact" },
        filters: [
          ["ip_hash", "not.is", null],
          ["created_at", "lt", "2026-08-07T03:00:00.000Z"],
        ],
      },
      {
        op: "enquiries.delete",
        options: { count: "exact" },
        filters: [
          ["status", "eq", "closed"],
          ["handled_at", "lt", "2025-09-06T03:00:00.000Z"],
        ],
      },
    ]);
    expect(boundary.info).toHaveBeenCalledWith("enquiries purged", {
      hashesCleared: 4,
      deleted: 2,
      hashCutoff: "2026-08-07T03:00:00.000Z",
      closedCutoff: "2025-09-06T03:00:00.000Z",
    });
  });

  it("reports zero when the database returns no count", async () => {
    boundary.counts = { update: null, delete: null };
    await expect(task.run()).resolves.toEqual({ hashesCleared: 0, deleted: 0 });
  });

  it("throws on a database error so the run fails visibly, before the delete", async () => {
    boundary.errors = { update: new Error("permission denied") };
    await expect(task.run()).rejects.toThrow("permission denied");
    expect(boundary.calls.map((call) => call.op)).toEqual(["enquiries.update"]);
    expect(boundary.info).not.toHaveBeenCalled();
  });
});
