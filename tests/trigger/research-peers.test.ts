// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The research-peers task against fakes (spec 0022, AC-5, AC-7, AC-8, AC-10): every read and write
 * is keyed by the ids of the run row it loaded, the fixture's eight peers land on the country rung
 * in one insert, a company with no industry section is skipped, a resumed attempt reuses the stored
 * peer provider run, the run's `status` and `error_code` are never written, and every path — the
 * happy one, the skip and the failure hook — triggers `benchmark-company` once under
 * `benchmark/run/<runId>` and raises no alert. The SDK, the env, the service client, the fixture
 * pauses and the validation call are the boundaries; validation is skipped unless a test sets one.
 */
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{
    table: string;
    op: string;
    filters: Array<[string, string, unknown]>;
    patch?: unknown;
  }>,
  alerts: [] as Array<Record<string, unknown>>,
  triggers: [] as Array<{ id: string; payload: unknown; options: unknown }>,
  /** When set, the next `tasks.trigger` rejects with this message. */
  triggerFailure: null as null | string,
  /** How many peer provider runs the fixture was asked to create (the resume invariant, AC-6). */
  peerRuns: 0,
  nextId: 1,
  /** What the fixture's poll answers when set (the provider reporting the run as failed). */
  providerStatus: null as null | "running" | "done" | "failed",
  /** The validation outcome the pass answers; null means skipped. */
  validation: null as null | { verdicts: Map<string, Row>; promptVersion: string },
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  queue: (options: unknown) => options,
  tasks: {
    trigger: async (id: string, payload: unknown, options: unknown) => {
      if (state.triggerFailure) throw new Error(state.triggerFailure);
      state.triggers.push({ id, payload, options });
      return { id: `run_${state.triggers.length}` };
    },
  },
  idempotencyKeys: { create: async (key: string) => key },
  wait: { for: vi.fn() },
  AbortTaskRunError: class AbortTaskRunError extends Error {},
  logger: { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn(), init: vi.fn(), flush: vi.fn() }));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/trigger/ops-alert", () => ({
  raiseAlertFromTask: async (alert: Record<string, unknown>) => {
    state.alerts.push(alert);
  },
}));
vi.mock("@/lib/env", () => ({ taskEnv: () => state.env }));
vi.mock("@/lib/research/fixture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research/fixture")>();
  return {
    ...actual,
    createFixtureProvider: () => {
      const provider = actual.createFixtureProvider(async () => {});
      return {
        ...provider,
        createPeerRun: async (...args: Parameters<typeof provider.createPeerRun>) => {
          state.peerRuns += 1;
          return provider.createPeerRun(...args);
        },
        getRun: async (providerRunId: string) =>
          state.providerStatus ? { status: state.providerStatus } : provider.getRun(providerRunId),
      };
    },
  };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase() }));
vi.mock("@/lib/research/validate-peers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/research/validate-peers")>();
  return { ...actual, validatePeers: async () => state.validation };
});

const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const RUN = "0d000000-0000-4000-8000-000000000001";

type Filter = [column: string, op: string, value: unknown];

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([column, op, value]) => {
    const actual = row[column];
    if (op === "in") return (value as unknown[]).includes(actual);
    return actual === value;
  });
}

function fakeSupabase() {
  return { from: (table: string) => builder(table) };
}

function builder(table: string) {
  const filters: Filter[] = [];
  let op = "select";
  let patch: Row | undefined;
  let inserted: Row[] | undefined;
  const rows = () => (state.tables[table] ??= []);
  const execute = () => {
    state.calls.push({ table, op, filters: [...filters], patch: patch ?? inserted });
    if (op === "select") {
      return { data: rows().filter((row) => matches(row, filters)), error: null };
    }
    if (op === "update") {
      const found = rows().filter((row) => matches(row, filters));
      for (const row of found) Object.assign(row, patch);
      return { data: found.map((row) => ({ id: row.id })), error: null };
    }
    if (op === "insert") {
      for (const row of inserted ?? []) {
        if (
          table === "research_peers" &&
          rows().some(
            (existing) =>
              existing.research_run_id === row.research_run_id &&
              existing.peer_name === row.peer_name &&
              existing.kpi_key === row.kpi_key,
          )
        ) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows().push({ id: `p${state.nextId++}`, ...row });
      }
      return { data: inserted, error: null };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: () => chain,
    update: (value: Row) => {
      op = "update";
      patch = value;
      return chain;
    },
    insert: (value: Row | Row[]) => {
      op = "insert";
      inserted = Array.isArray(value) ? value : [value];
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, "eq", value]);
      return chain;
    },
    maybeSingle: async () => {
      const result = execute();
      return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject),
  };
  return chain;
}

function seed(company: Partial<Row> = {}, run: Partial<Row> = {}) {
  state.tables = {
    companies: [
      {
        id: COMPANY,
        organization_id: ORG,
        name: "Muster AG",
        legal_name: null,
        website: "https://muster.ch",
        country: "CH",
        // Division 25 sits in section C, so the fixture peers carry a section (AC-5).
        industry_code: "25.11",
        employees_count: 300,
        ...company,
      },
    ],
    research_runs: [
      {
        id: RUN,
        organization_id: ORG,
        company_id: COMPANY,
        status: "succeeded",
        provider_run_id: "fixture_x",
        peer_provider_run_id: null,
        summary: { version: 1, step: "done", kpisExtracted: 3 },
        error_code: null,
        ...run,
      },
    ],
    research_peers: [],
  };
}

const ctx = { run: { id: "run_trigger_1" }, attempt: { number: 1 }, project: { ref: "proj_test" } };

async function loadTask() {
  const module = await import("@/trigger/research-peers");
  return module.researchPeersTask as unknown as {
    run: (payload: { runId: string }, options: { ctx: typeof ctx }) => Promise<Row>;
    onFailure: (input: {
      payload: { runId: string };
      error: unknown;
      ctx: typeof ctx;
    }) => Promise<void>;
  };
}

const runRow = () => state.tables.research_runs?.[0] as Row;
const peersSummary = () => (runRow().summary as Row).peers as Row;

beforeEach(() => {
  state.env = {
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    RESEARCH_PROVIDER: "fixture",
    AI_GATEWAY_API_KEY: undefined,
  };
  state.calls = [];
  state.alerts = [];
  state.triggers = [];
  state.triggerFailure = null;
  state.peerRuns = 0;
  state.nextId = 1;
  state.providerStatus = null;
  state.validation = null;
});

describe("research-peers (AC-5, AC-7, AC-10)", () => {
  it("runs the fixture peer search end to end onto the country rung", async () => {
    seed();
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toMatchObject({ status: "ok", rung: "country" });

    // Five of the fixture's eight peers are Swiss, so the ladder stops at the country rung (AC-11).
    expect(peersSummary()).toMatchObject({
      status: "ok",
      found: 5,
      rung: "country",
      thin: false,
      validation: "skipped",
    });
    expect(runRow().peer_provider_run_id).toMatch(/^fixture_peers_/);
    // The peer task never touches the run's own status or error code (AC-7).
    expect(runRow().status).toBe("succeeded");
    expect(runRow().error_code).toBeNull();
    // The client task's summary fields survive the merge.
    expect((runRow().summary as Row).kpisExtracted).toBe(3);

    // Four of the five Swiss fixture peers publish both rates and the fifth only LTIFR (AC-11), so
    // the five kept peers are nine rows: one per peer and KPI (AC-10).
    const rows = state.tables.research_peers ?? [];
    expect(rows).toHaveLength(9);
    for (const row of rows) {
      expect(row).toMatchObject({
        organization_id: ORG,
        company_id: COMPANY,
        research_run_id: RUN,
        peer_country: "CH",
        industry_section: "C",
        rung: "country",
        confidence: 0.5,
      });
      expect(row.source_url).toBeTruthy();
    }
    // One insert statement carried every row (AC-10).
    const inserts = state.calls.filter(
      (call) => call.table === "research_peers" && call.op === "insert",
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.patch).toHaveLength(9);
  });

  it("converts the printed units in code, per 200 000 hours times five", async () => {
    seed();
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    // The fixture's country peers print 1.2, 0.9, 1.5 and 2.1 per 200 000 hours plus one per
    // million (AC-11), so every stored value is five times its published figure or the figure
    // itself (AC-8).
    for (const row of state.tables.research_peers ?? []) {
      const factor = row.unit_as_published === "per_million_hours" ? 1 : 5;
      expect(row.value).toBeCloseTo((row.value_as_published as number) * factor, 5);
    }
  });

  it("triggers the benchmark once under benchmark/run/<runId> and raises no alert", async () => {
    seed();
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    expect(state.triggers).toHaveLength(1);
    expect(state.triggers[0]).toMatchObject({
      id: "benchmark-company",
      payload: { companyId: COMPANY, triggerKind: "research", researchRunId: RUN },
      options: { idempotencyKey: `benchmark/run/${RUN}`, idempotencyKeyTTL: "24h" },
    });
    expect(state.alerts).toHaveLength(0);
  });

  it("skips the search when the company carries no industry section and still triggers", async () => {
    seed({ industry_code: null });
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toEqual({ status: "skipped" });
    expect(peersSummary()).toMatchObject({ status: "skipped", found: 0, rung: null, thin: true });
    expect(state.peerRuns).toBe(0);
    expect(state.tables.research_peers).toHaveLength(0);
    expect(state.triggers).toHaveLength(1);
    expect(state.triggers[0]).toMatchObject({ id: "benchmark-company" });
  });

  it("lands on the world rung with thin when the fixture gives two peers", async () => {
    seed({ name: "Thinpeers AG" });
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toMatchObject({ status: "ok", rung: "world" });
    expect(peersSummary()).toMatchObject({ found: 2, rung: "world", thin: true });
    expect((state.tables.research_peers ?? []).every((row) => row.rung === "world")).toBe(true);
  });

  it("writes no row and no rung when the provider answers no peers", async () => {
    seed({ name: "Empty AG" });
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toMatchObject({ status: "ok", found: 0, rung: null });
    expect(peersSummary()).toMatchObject({ status: "ok", found: 0, rung: null, thin: true });
    expect(state.tables.research_peers).toHaveLength(0);
    expect(state.triggers).toHaveLength(1);
  });

  it("resumes the stored peer provider run instead of creating a second one", async () => {
    seed();
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    const stored = runRow().peer_provider_run_id;
    expect(state.peerRuns).toBe(1);

    state.calls = [];
    state.triggers = [];
    state.tables.research_peers = [];
    await task.run({ runId: RUN }, { ctx: { ...ctx, attempt: { number: 2 } } });
    expect(state.peerRuns).toBe(1);
    expect(runRow().peer_provider_run_id).toBe(stored);
  });

  it("swallows the unique violation of a retried insert", async () => {
    seed();
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    const first = (state.tables.research_peers ?? []).length;
    await task.run({ runId: RUN }, { ctx: { ...ctx, attempt: { number: 2 } } });
    expect(state.tables.research_peers).toHaveLength(first);
    expect(peersSummary()).toMatchObject({ status: "ok", found: 5 });
  });

  it("keys every read and write by the loaded row's ids", async () => {
    seed();
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    for (const call of state.calls.filter((entry) => entry.table === "research_runs")) {
      expect(call.filters).toContainEqual(["id", "eq", RUN]);
    }
    for (const call of state.calls.filter((entry) => entry.table === "companies")) {
      expect(call.filters).toContainEqual(["organization_id", "eq", ORG]);
    }
  });

  it("uses the validator's confidence when the call answered", async () => {
    seed();
    const { verdictKey } = await import("@/lib/research/validate-peers");
    const verdicts = new Map<string, Row>();
    // Peers 0 to 4 are the Swiss ones; support only peer 0's LTIFR, so one peer survives and the
    // ladder falls past the country rung to the world (AC-7, AC-8).
    verdicts.set(verdictKey(0, "ltifr"), {
      peerIndex: 0,
      kpiKey: "ltifr",
      supported: true,
      periodYear: 2024,
      confidence: 0.85,
      sourceIndexes: [0],
    });
    state.validation = { verdicts, promptVersion: "peer-validation@1" };
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    expect(peersSummary()).toMatchObject({
      status: "ok",
      found: 1,
      rung: "world",
      thin: true,
      validation: "passed",
      promptVersion: "peer-validation@1",
    });
    const rows = state.tables.research_peers ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ confidence: 0.85, period_year: 2024, kpi_key: "ltifr" });
    // The seven peers the ladder and the validator left out are dropped as unsupported (AC-8).
    expect(peersSummary().dropped).toHaveLength(7);
  });

  it("aborts with peer_rejected when the provider reports the peer run as failed", async () => {
    seed();
    state.providerStatus = "failed";
    const task = await loadTask();
    await expect(task.run({ runId: RUN }, { ctx })).rejects.toThrow(/^peer_rejected/);
    expect(runRow().status).toBe("succeeded");
  });

  it("throws the retryable class on a fixture provider failure", async () => {
    seed({ name: "Fail AG" });
    const task = await loadTask();
    await expect(task.run({ runId: RUN }, { ctx })).rejects.toThrow(/^peer_unavailable/);
  });
});

describe("research-peers onFailure (AC-7)", () => {
  it("records failed, triggers the benchmark once and raises no alert", async () => {
    seed();
    const task = await loadTask();
    await task.onFailure({ payload: { runId: RUN }, error: new Error("boom"), ctx });
    expect(peersSummary()).toMatchObject({
      status: "failed",
      found: 0,
      rung: null,
      thin: true,
      reason: "The peer search failed.",
    });
    // The run the client task closed is untouched.
    expect(runRow().status).toBe("succeeded");
    expect(runRow().error_code).toBeNull();
    expect(state.alerts).toHaveLength(0);
    expect(state.triggers).toHaveLength(1);
    expect(state.triggers[0]).toMatchObject({
      id: "benchmark-company",
      options: { idempotencyKey: `benchmark/run/${RUN}` },
    });
  });

  it("records timeout for a budget abort", async () => {
    seed();
    const task = await loadTask();
    await task.onFailure({
      payload: { runId: RUN },
      error: new Error("peer_timeout: no peer result within 20 minutes"),
      ctx,
    });
    expect(peersSummary()).toMatchObject({ status: "timeout" });
  });

  it("does nothing for a run that is gone", async () => {
    seed();
    state.tables.research_runs = [];
    const task = await loadTask();
    await task.onFailure({ payload: { runId: RUN }, error: new Error("boom"), ctx });
    expect(state.triggers).toHaveLength(0);
  });
});
