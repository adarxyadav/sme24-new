// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boundary = vi.hoisted(() => ({
  due: [] as Array<{ id: string }>,
  flagged: 0,
  startRuns: vi.fn(),
  raiseAlert: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  schedules: { task: (options: unknown) => options },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn() } }));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({ SUPABASE_SECRET_KEY: "k", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: () => builder() }),
}));
vi.mock("@/features/peers/runs", () => ({ startPeerRuns: boundary.startRuns }));
vi.mock("@/trigger/ops-alert", () => ({ raiseAlertFromTask: boundary.raiseAlert }));

function builder() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    lt: () => chain,
    or: () => chain,
    order: () => chain,
    limit: async () => ({ data: boundary.due, error: null }),
    gte: async () => ({ count: boundary.flagged, error: null }),
  };
  return chain;
}

const { refreshPeerCompaniesTask } = await import("@/trigger/refresh-peer-companies");
const task = refreshPeerCompaniesTask as unknown as {
  run: (
    payload: unknown,
    context: { ctx: { run: { id: string } } },
  ) => Promise<{ triggered: number; skipped: number; flagged: number }>;
};
const run = () => task.run({}, { ctx: { run: { id: "schedule-run" } } });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ now: new Date("2026-09-08T03:30:00Z"), toFake: ["Date"] });
  boundary.due = [];
  boundary.flagged = 0;
  boundary.startRuns.mockResolvedValue({ triggered: [{ peerId: "due-peer" }], skipped: [] });
  boundary.raiseAlert.mockResolvedValue(undefined);
});

afterEach(() => vi.useRealTimers());

describe("peer refresh alerts", () => {
  it.each([{ due: [] }, { due: [{ id: "due-peer" }] }])(
    "alerts ops about flagged peers with eligible peers $due",
    async ({ due }) => {
      boundary.due = due;
      boundary.flagged = 3;

      await expect(run()).resolves.toMatchObject({
        triggered: due.length,
        skipped: 0,
        flagged: 3,
      });
      expect(boundary.raiseAlert).toHaveBeenCalledExactlyOnceWith({
        kind: "peers.refresh_flagged",
        fields: { flagged: 3, limit: 3 },
        link: "/admin/peers",
        idempotencyKey: "peers-flagged/2026-09-08",
      });
      expect(boundary.startRuns).toHaveBeenCalledTimes(due.length);
    },
  );

  it("does nothing when no peers are due or flagged", async () => {
    await expect(run()).resolves.toEqual({ triggered: 0, skipped: 0, flagged: 0 });
    expect(boundary.raiseAlert).not.toHaveBeenCalled();
    expect(boundary.startRuns).not.toHaveBeenCalled();
  });
});
