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

function row(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "0e000000-0000-4000-8000-000000000001",
    organization_id: "0a000000-0000-4000-8000-000000000000",
    company_id: "0c000000-0000-4000-8000-00000000000a",
    research_run_id: null,
    trigger_kind: "research",
    model_version: MODEL_VERSION,
    peer_provisional: true,
    kpis_compared: 1,
    confidence: 0.9,
    cost_chf: 1234.5,
    cost_low_chf: 1000,
    cost_high_chf: 2000,
    saving_median_chf: 300,
    saving_top_chf: 500,
    inputs: {
      fte: 420,
      section: "C",
      sizeBand: "250+",
      industryCode: "23.61",
      companyUpdatedAt: "2026-09-06T10:00:00.000Z",
      kpis: [],
    },
    results: [],
    gaps: [],
    cost: null,
    assumptions: [],
    created_at: "2026-09-06T10:04:00.000Z",
    updated_at: "2026-09-06T10:04:00.000Z",
    ...overrides,
  };
}

const snapshot = (kpisCompared: number): ParsedSnapshot => {
  const parsed = parseSnapshotRow(row({ kpis_compared: kpisCompared }));
  if (!parsed.snapshot) throw new Error(parsed.error);
  return parsed.snapshot;
};

describe("parseSnapshotRow (spec 0008, AC-9)", () => {
  it("parses a version 1 row into numbers and blocks", () => {
    const parsed = parseSnapshotRow(row());
    expect(parsed.error).toBeNull();
    expect(parsed.snapshot?.costChf).toBe(1234.5);
    expect(parsed.snapshot?.blocks.inputs.section).toBe("C");
  });

  it("treats an unknown version or broken blocks as unreadable", () => {
    expect(parseSnapshotRow(row({ model_version: "benchmark-model@0" })).snapshot).toBeNull();
    expect(parseSnapshotRow(row({ results: "nope" })).snapshot).toBeNull();
  });
});

describe("benchmarkStateOf (spec 0008, AC-9)", () => {
  const succeeded = (finishedAt: string) => ({ status: "succeeded", finished_at: finishedAt });

  it("is ready with a snapshot and noData when nothing compared", () => {
    expect(
      benchmarkStateOf({
        snapshot: snapshot(3),
        latestRun: null,
        companyUpdatedAt: ago(0),
        now: NOW,
      }),
    ).toBe("ready");
    expect(
      benchmarkStateOf({
        snapshot: snapshot(0),
        latestRun: null,
        companyUpdatedAt: ago(0),
        now: NOW,
      }),
    ).toBe("noData");
  });

  it("is calculating within the wait window after a succeeded run or a company edit, else unavailable", () => {
    const old = ago(60 * 60 * 1000);
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: succeeded(ago(30_000)),
        companyUpdatedAt: old,
        now: NOW,
      }),
    ).toBe("calculating");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: succeeded(ago(3 * 60_000)),
        companyUpdatedAt: old,
        now: NOW,
      }),
    ).toBe("unavailable");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: succeeded(ago(3 * 60_000)),
        companyUpdatedAt: ago(BENCHMARK_WAIT_MS - 1),
        now: NOW,
      }),
    ).toBe("calculating");
    expect(
      benchmarkStateOf({
        snapshot: null,
        latestRun: { status: "empty", finished_at: ago(0) },
        companyUpdatedAt: old,
        now: NOW,
      }),
    ).toBe("unavailable");
    expect(
      benchmarkStateOf({ snapshot: null, latestRun: null, companyUpdatedAt: old, now: NOW }),
    ).toBe("unavailable");
  });
});

describe("loadLatestSnapshot (spec 0008, AC-9)", () => {
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

  it("returns null for no row and for an unreadable row", async () => {
    expect(await loadLatestSnapshot(client(null).client as never, "x")).toBeNull();
    expect(
      await loadLatestSnapshot(
        client(row({ model_version: "benchmark-model@0" })).client as never,
        "x",
      ),
    ).toBeNull();
  });
});
