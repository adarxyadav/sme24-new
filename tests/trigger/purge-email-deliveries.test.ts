// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TIME_ZONE } from "@/i18n/formats";

/**
 * The weekly retention task (spec 0006, AC-12): Mondays at 03:00 Zurich time it deletes
 * `email_deliveries` rows older than 90 days, touches no other table, logs the count and throws
 * on a database error. The SDK, the env and the service client are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  count: null as number | null,
  error: null as unknown,
  deletes: [] as Array<{ table: string; options: unknown; column: string; value: string }>,
  info: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  schedules: { task: (options: unknown) => options },
  logger: { info: boundary.info, warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({
    SUPABASE_SECRET_KEY: "k",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      delete: (options: unknown) => ({
        lt: async (column: string, value: string) => {
          boundary.deletes.push({ table, options, column, value });
          return { count: boundary.count, error: boundary.error };
        },
      }),
    }),
  }),
}));

const { purgeEmailDeliveries, RETENTION_DAYS } = await import("@/trigger/purge-email-deliveries");
const task = purgeEmailDeliveries as unknown as {
  id: string;
  cron: unknown;
  run: () => Promise<{ deleted: number }>;
};

/** Saturday 5 September 2026, 03:00 UTC: 90 days earlier is 7 June. */
const AT = new Date("2026-09-05T03:00:00Z");

beforeEach(() => {
  boundary.count = 12;
  boundary.error = null;
  boundary.deletes = [];
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("purge-email-deliveries (AC-12)", () => {
  it("is scheduled weekly on Monday 03:00 in Zurich time", () => {
    expect(task.id).toBe("purge-email-deliveries");
    expect(task.cron).toEqual({ pattern: "0 3 * * 1", timezone: TIME_ZONE });
    expect(RETENTION_DAYS).toBe(90);
  });

  it("deletes only email_deliveries rows created before the 90 day cutoff and logs the count", async () => {
    await expect(task.run()).resolves.toEqual({ deleted: 12 });
    expect(boundary.deletes).toEqual([
      {
        table: "email_deliveries",
        options: { count: "exact" },
        column: "created_at",
        value: "2026-06-07T03:00:00.000Z",
      },
    ]);
    expect(boundary.info).toHaveBeenCalledWith("email deliveries purged", {
      deleted: 12,
      cutoff: "2026-06-07T03:00:00.000Z",
    });
  });

  it("reports zero when the database returns no count", async () => {
    boundary.count = null;
    await expect(task.run()).resolves.toEqual({ deleted: 0 });
  });

  it("throws on a database error so the run fails visibly", async () => {
    boundary.error = new Error("permission denied");
    await expect(task.run()).rejects.toThrow("permission denied");
    expect(boundary.info).not.toHaveBeenCalled();
  });
});
