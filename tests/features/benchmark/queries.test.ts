import { describe, expect, it, vi } from "vitest";
import { BENCHMARK_WAIT_MS, MODEL_VERSION } from "@/features/benchmark/catalogue";
import {
  benchmarkStateOf,
  loadLatestSnapshot,
  type ParsedSnapshot,
  parseSnapshotRow,
  type SnapshotRow,
} from "@/features/benchmark/queries";

vi.mock("@sentry/nextjs", () => ({ captureMessage: vi.fn() }));

const NOW = new Date("2026-09-06T10:05:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

const LOSS = {
  ltis: 5.4,
  recordables: 3.6,
  trifrMissing: false,
  fatalities: 0,
  loss: 365_715,
  atMedian: 200_000,
  atBest: 100_000,
  savingAtMedian: 165_715,
  savingAtBest: 265_715,
};

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "0e000000-0000-4000-8000-000000000001",
    organization_id: "0a000000-0000-4000-8000-000000000000",
    company_id: "0c000000-0000-4000-8000-00000000000a",
    research_run_id: null,
    trigger_kind: "research",
    model_version: MODEL_VERSION,
    peer_provisional: false,
    kpis_compared: 1,
    confidence: 0.9,
    cost_chf: null,
    cost_low_chf: null,
    cost_high_chf: null,
    saving_median_chf: null,
    saving_top_chf: null,
    inputs: {
      fte: 500,
      section: "C",
      industryCode: "23.61",
      country: "CH",
      currency: "CHF",
      companyUpdatedAt: "2026-09-06T10:00:00.000Z",
      kpis: [],
    },
    results: null,
    gaps: null,
    assumptions: null,
    // `@7` stores the loss block in `cost` and the recommendation in `derived` (spec 0022, AC-16).
    cost: LOSS,
    derived: { packageKey: "sms", reason: "one_worse" },
    peers: null,
    currency: "CHF",
    loss_amount: 365_715,
    saving_at_median: 165_715,
    created_at: "2026-09-06T10:04:00.000Z",
    updated_at: "2026-09-06T10:04:00.000Z",
    ...overrides,
  };
}

const snapshot = (overrides: Partial<SnapshotRow> = {}): ParsedSnapshot =>
  parseSnapshotRow(row(overrides)).snapshot;

describe("parseSnapshotRow (spec 0022, AC-12, AC-16, AC-18)", () => {
  it("parses a benchmark-model@7 row into numbers and blocks", () => {
    const parsed = parseSnapshotRow(row());
    expect(parsed.error).toBeNull();
    expect(parsed.snapshot.currency).toBe("CHF");
    expect(parsed.snapshot.lossAmount).toBe(365_715);
    expect(parsed.snapshot.savingAtMedian).toBe(165_715);
    expect(parsed.snapshot.blocks?.inputs.section).toBe("C");
    // The loss rides in `cost` and the recommendation in `derived`; the reader names neither column.
    expect(parsed.snapshot.blocks?.loss?.loss).toBe(365_715);
    expect(parsed.snapshot.blocks?.recommendation.packageKey).toBe("sms");
  });

  it("keeps the raw version and drops the blocks of a row it cannot read (AC-18)", () => {
    const old = parseSnapshotRow(row({ model_version: "benchmark-model@5" }));
    expect(old.error).toBe("unknown model version benchmark-model@5");
    expect(old.snapshot.modelVersion).toBe("benchmark-model@5");
    expect(old.snapshot.blocks).toBeNull();
    expect(parseSnapshotRow(row({ inputs: "nope" })).snapshot.blocks).toBeNull();
  });
});

describe("benchmarkStateOf (spec 0008, AC-9; spec 0022, AC-18)", () => {
  const succeeded = (finishedAt: string) => ({ status: "succeeded", finished_at: finishedAt });

  it("is calculating within the wait window after a client KPI save with no snapshot yet (spec 0010, AC-13)", () => {
    const old = ago(60 * 60 * 1000);
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: { status: "empty", finished_at: old },
        companyUpdatedAt: old,
        clientKpiUpdatedAt: ago(20_000),
        now: NOW,
      }),
    ).toBe("calculating");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: { status: "empty", finished_at: old },
        companyUpdatedAt: old,
        clientKpiUpdatedAt: ago(BENCHMARK_WAIT_MS + 1),
        now: NOW,
      }),
    ).toBe("unavailable");
    expect(
      benchmarkStateOf({
        snapshot: snapshot(),
        latestRun: null,
        companyUpdatedAt: old,
        clientKpiUpdatedAt: ago(1_000),
        now: NOW,
      }),
    ).toBe("ready");
  });

  it("is ready with a loss or peers, noData with neither", () => {
    expect(
      benchmarkStateOf({
        snapshot: snapshot(),
        latestRun: null,
        companyUpdatedAt: ago(0),
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("ready");
    expect(
      benchmarkStateOf({
        snapshot: snapshot({ cost: null, peers: null, loss_amount: null }),
        latestRun: null,
        companyUpdatedAt: ago(0),
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("noData");
  });

  it("is outdated for a snapshot of an older model version (AC-18)", () => {
    expect(
      benchmarkStateOf({
        snapshot: snapshot({ model_version: "benchmark-model@5" }),
        latestRun: null,
        companyUpdatedAt: ago(0),
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("outdated");
  });

  it("is calculating within the wait window after a succeeded run or a company edit, else unavailable", () => {
    const old = ago(60 * 60 * 1000);
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: succeeded(ago(30_000)),
        companyUpdatedAt: old,
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("calculating");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: succeeded(ago(3 * 60_000)),
        companyUpdatedAt: old,
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("unavailable");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: succeeded(ago(3 * 60_000)),
        companyUpdatedAt: ago(BENCHMARK_WAIT_MS - 1),
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("calculating");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: { status: "empty", finished_at: ago(0) },
        companyUpdatedAt: old,
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("unavailable");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: null,
        companyUpdatedAt: old,
        clientKpiUpdatedAt: null,
        now: NOW,
      }),
    ).toBe("unavailable");
  });
});

describe("loadLatestSnapshot (spec 0008, AC-9; spec 0022, AC-18)", () => {
  function client(data: SnapshotRow | null) {
    const steps: Array<[string, unknown[]]> = [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        steps.push([method, args]);
        return chain;
      };
    }
    chain.maybeSingle = async () => ({ data, error: null });
    return { steps, client: { from: () => chain } };
  }

  it("orders by created_at descending, limits to one and parses the row", async () => {
    const { steps, client: fake } = client(row());
    const result = await loadLatestSnapshot(fake as never, "0c000000-0000-4000-8000-00000000000a");
    expect(result?.id).toBe("0e000000-0000-4000-8000-000000000001");
    expect(steps).toEqual([
      ["select", ["*"]],
      ["eq", ["company_id", "0c000000-0000-4000-8000-00000000000a"]],
      ["order", ["created_at", { ascending: false }]],
      ["order", ["id", { ascending: false }]],
      ["limit", [1]],
    ]);
  });

  it("returns null for no row and an unreadable row with its raw version (AC-18)", async () => {
    expect(await loadLatestSnapshot(client(null).client as never, "x")).toBeNull();
    const old = await loadLatestSnapshot(
      client(row({ model_version: "benchmark-model@5" })).client as never,
      "x",
    );
    expect(old?.modelVersion).toBe("benchmark-model@5");
    expect(old?.blocks).toBeNull();
  });
});
