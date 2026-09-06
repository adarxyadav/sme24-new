// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The stale sweep (spec 0007, AC-11): every 15 minutes, runs `queued` for more than 30 minutes
 * and `running` for more than 60 minutes become `failed` with `stale`, each update guarded by the
 * row's current status, one alert per swept run keyed `research-stale/<runId>`, the counts
 * returned and logged. The SDK, the env, the service client and the alert are the boundaries.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  runs: [] as Row[],
  /** When set, what the stale select answers regardless of the live rows (a stale snapshot). */
  snapshot: null as Row[] | null,
  organizations: [] as Row[],
  selectError: null as unknown,
  updates: [] as Array<{ patch: Row; filters: Array<[string, unknown]> }>,
  alerts: [] as Array<Record<string, unknown>>,
  warn: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  schedules: { task: (options: unknown) => options },
  logger: { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: boundary.warn, error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/trigger/ops-alert", () => ({
  raiseAlertFromTask: async (alert: Record<string, unknown>) => {
    boundary.alerts.push(alert);
  },
}));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({ SUPABASE_SECRET_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: (_column: string, id: string) => ({
              maybeSingle: async () => ({
                data: boundary.organizations.find((row) => row.id === id) ?? null,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table !== "research_runs") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: (_status: string, status: string) => ({
            lt: async (column: string, iso: string) => ({
              data: boundary.selectError
                ? null
                : (boundary.snapshot ??
                  boundary.runs.filter(
                    (row) => row.status === status && String(row[column] ?? "") < iso,
                  )),
              error: boundary.selectError,
            }),
          }),
        }),
        update: (patch: Row) => {
          const filters: Array<[string, unknown]> = [];
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              return chain;
            },
            select: async () => {
              boundary.updates.push({ patch, filters });
              const found = boundary.runs.filter((row) =>
                filters.every(([column, value]) => row[column] === value),
              );
              for (const row of found) Object.assign(row, patch);
              return { data: found.map((row) => ({ id: row.id })), error: null };
            },
          };
          return chain;
        },
      };
    },
  }),
}));

const { STALE_QUEUED_MINUTES, STALE_RUNNING_MINUTES, sweepResearchRunsTask } = await import(
  "@/trigger/sweep-research-runs"
);
const task = sweepResearchRunsTask as unknown as {
  id: string;
  cron: string;
  run: () => Promise<{ queuedSwept: number; runningSwept: number }>;
};

const ORG = "0a000000-0000-4000-8000-000000000000";
const AT = new Date("2026-09-06T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(AT.getTime() - minutes * 60_000).toISOString();

function run(overrides: Row): Row {
  return {
    id: `run-${boundary.runs.length + 1}`,
    organization_id: ORG,
    company_id: "0c000000-0000-4000-8000-00000000000a",
    status: "queued",
    created_at: minutesAgo(5),
    started_at: null,
    error_code: null,
    finished_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  boundary.runs = [];
  boundary.snapshot = null;
  boundary.organizations = [{ id: ORG, name: "Muster AG" }];
  boundary.selectError = null;
  boundary.updates = [];
  boundary.alerts = [];
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sweep-research-runs (AC-11)", () => {
  it("is registered every 15 minutes with the thresholds the spec names", () => {
    expect(task.id).toBe("sweep-research-runs");
    expect(task.cron).toBe("*/15 * * * *");
    expect(STALE_QUEUED_MINUTES).toBe(30);
    expect(STALE_RUNNING_MINUTES).toBe(60);
  });

  it("closes a run queued for over 30 minutes and one running for over 60 minutes as stale, leaving fresh ones alone", async () => {
    boundary.runs.push(
      run({ id: "old-queued", created_at: minutesAgo(31) }),
      run({ id: "fresh-queued", created_at: minutesAgo(29) }),
      run({ id: "old-running", status: "running", started_at: minutesAgo(61) }),
      run({ id: "fresh-running", status: "running", started_at: minutesAgo(59) }),
      run({ id: "done", status: "succeeded", created_at: minutesAgo(600) }),
    );
    await expect(task.run()).resolves.toEqual({ queuedSwept: 1, runningSwept: 1 });

    const byId = new Map(boundary.runs.map((row) => [row.id, row]));
    for (const id of ["old-queued", "old-running"]) {
      expect(byId.get(id)).toMatchObject({
        status: "failed",
        error_code: "stale",
        error_message: "The run was stuck and was closed by the sweep.",
        finished_at: AT.toISOString(),
      });
    }
    expect(byId.get("fresh-queued")?.status).toBe("queued");
    expect(byId.get("fresh-running")?.status).toBe("running");
    expect(byId.get("done")?.status).toBe("succeeded");
  });

  it("guards each update by the row's current status", async () => {
    boundary.runs.push(run({ id: "old-queued", created_at: minutesAgo(45) }));
    await task.run();
    expect(boundary.updates).toEqual([
      {
        patch: expect.objectContaining({ status: "failed", error_code: "stale" }),
        filters: [
          ["id", "old-queued"],
          ["status", "queued"],
        ],
      },
    ]);
  });

  it("raises one alert per swept run with the organization's name, the reason and the stale key", async () => {
    boundary.runs.push(
      run({ id: "old-queued", created_at: minutesAgo(45) }),
      run({ id: "old-running", status: "running", started_at: minutesAgo(90) }),
    );
    await task.run();
    expect(boundary.alerts).toEqual([
      {
        kind: "research.run_failed",
        fields: {
          runId: "old-queued",
          organizationName: "Muster AG",
          reason: "stale: queued for more than 30 minutes",
        },
        idempotencyKey: "research-stale/old-queued",
      },
      {
        kind: "research.run_failed",
        fields: {
          runId: "old-running",
          organizationName: "Muster AG",
          reason: "stale: running for more than 60 minutes",
        },
        idempotencyKey: "research-stale/old-running",
      },
    ]);
    expect(boundary.warn).toHaveBeenCalledTimes(2);
  });

  it("falls back to an unknown organization name when the row is gone", async () => {
    boundary.organizations = [];
    boundary.runs.push(run({ id: "old-queued", created_at: minutesAgo(45) }));
    await task.run();
    expect(boundary.alerts[0]?.fields).toMatchObject({ organizationName: "Unknown organization" });
  });

  it("skips a row another writer closed between the select and the update, with no alert", async () => {
    // The select saw the row as running; the task attempt finished it before the guarded update.
    const finished = run({ id: "raced", status: "succeeded", started_at: minutesAgo(90) });
    boundary.runs.push(finished);
    boundary.snapshot = [{ ...finished, status: "running" }];
    await expect(task.run()).resolves.toEqual({ queuedSwept: 0, runningSwept: 0 });
    expect(boundary.updates.map((update) => update.filters)).toEqual([
      [
        ["id", "raced"],
        ["status", "queued"],
      ],
      [
        ["id", "raced"],
        ["status", "running"],
      ],
    ]);
    expect(boundary.alerts).toEqual([]);
    expect(finished).toMatchObject({ status: "succeeded", error_code: null });
  });

  it("sweeps nothing and alerts nobody when every run is fresh", async () => {
    boundary.runs.push(run({}), run({ status: "running", started_at: minutesAgo(10) }));
    await expect(task.run()).resolves.toEqual({ queuedSwept: 0, runningSwept: 0 });
    expect(boundary.updates).toEqual([]);
    expect(boundary.alerts).toEqual([]);
  });

  it("throws on a database error so Trigger.dev retries the schedule", async () => {
    boundary.selectError = new Error("connection reset");
    await expect(task.run()).rejects.toThrow("connection reset");
  });
});
