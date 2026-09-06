// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The research-company task against fakes (spec 0007, AC-4, AC-6, AC-10, AC-14): every write is
 * keyed by the ids of the run row it loaded, a resumed attempt reuses the stored provider run and
 * never resets the status, a run closed by the sweep mid save stops without a terminal write, the
 * failure hook records the error code once and raises the alert with the Trigger.dev link, and
 * the fixture `fail` name throws the retryable class. The SDK, the env, the service client, the
 * fixture pauses and the alert are the boundaries; validation is skipped (no gateway key).
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
  onKpiInsert: null as null | (() => void),
  createRuns: 0,
  nextId: 1,
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  queue: (options: unknown) => options,
  tasks: { onFailure: vi.fn() },
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
        createRun: async (...args: Parameters<typeof provider.createRun>) => {
          state.createRuns += 1;
          return provider.createRun(...args);
        },
      };
    },
  };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase() }));

const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const RUN = "0d000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000000";
const OTHER_COMPANY = "0c000000-0000-4000-8000-00000000000b";

type Filter = [column: string, op: string, value: unknown];

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([column, op, value]) => {
    const actual = row[column];
    if (op === "eq") return actual === value;
    if (op === "in") return (value as unknown[]).includes(actual);
    if (op === "is") return actual === value;
    return true;
  });
}

function fakeSupabase() {
  return {
    from: (table: string) => builder(table),
  };
}

function builder(table: string) {
  const filters: Filter[] = [];
  let op = "select";
  let patch: Row | undefined;
  let inserted: Row[] | undefined;
  let count = false;
  const rows = () => (state.tables[table] ??= []);
  const execute = () => {
    state.calls.push({ table, op, filters: [...filters], patch: patch ?? inserted });
    if (op === "select") {
      const found = rows().filter((row) => matches(row, filters));
      return count
        ? { data: null, error: null, count: found.length }
        : { data: found, error: null };
    }
    if (op === "update") {
      const found = rows().filter((row) => matches(row, filters));
      for (const row of found) Object.assign(row, patch);
      return { data: found.map((row) => ({ id: row.id })), error: null };
    }
    if (op === "insert") {
      for (const row of inserted ?? []) {
        if (
          table === "company_kpis" &&
          rows().some(
            (existing) =>
              existing.research_run_id === row.research_run_id &&
              existing.kpi_key === row.kpi_key &&
              existing.period_year === row.period_year,
          )
        ) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows().push({ id: `k${state.nextId++}`, ...row });
      }
      if (table === "company_kpis") state.onKpiInsert?.();
      return { data: inserted, error: null };
    }
    return { data: null, error: null };
  };
  const chain = {
    select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
      if (op === "select") count = Boolean(options?.head);
      return chain;
    },
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
    in: (column: string, values: unknown[]) => {
      filters.push([column, "in", values]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push([column, "is", value]);
      return chain;
    },
    maybeSingle: async () => {
      const result = execute();
      return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
    },
    single: async () => {
      const result = execute();
      return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject),
  };
  return chain;
}

function seed(run: Partial<Row> = {}) {
  state.tables = {
    organizations: [
      { id: ORG, name: "Org A" },
      { id: OTHER_ORG, name: "Org B" },
    ],
    companies: [
      {
        id: COMPANY,
        organization_id: ORG,
        name: "Muster AG",
        legal_name: null,
        website: "https://muster.ch",
        country: "CH",
        uid: null,
        canton: null,
        industry_code: null,
        employees_count: null,
      },
      {
        id: OTHER_COMPANY,
        organization_id: OTHER_ORG,
        name: "Other AG",
        legal_name: null,
        website: null,
        country: "CH",
      },
    ],
    research_runs: [
      {
        id: RUN,
        organization_id: ORG,
        company_id: COMPANY,
        status: "queued",
        provider_run_id: null,
        started_at: null,
        finished_at: null,
        summary: null,
        error_code: null,
        ...run,
      },
    ],
    company_kpis: [],
  };
}

const ctx = { run: { id: "run_trigger_1" }, attempt: { number: 1 }, project: { ref: "proj_test" } };

async function loadTask() {
  const module = await import("@/trigger/research-company");
  return module.researchCompanyTask as unknown as {
    run: (payload: { runId: string }, options: { ctx: typeof ctx }) => Promise<Row>;
    onFailure: (input: {
      payload: { runId: string };
      error: unknown;
      ctx: typeof ctx;
    }) => Promise<void>;
  };
}

function writes(table: string) {
  return state.calls.filter((call) => call.table === table && call.op !== "select");
}

beforeEach(() => {
  state.env = {
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    RESEARCH_PROVIDER: "fixture",
    AI_GATEWAY_API_KEY: undefined,
  };
  state.calls = [];
  state.alerts = [];
  state.onKpiInsert = null;
  state.createRuns = 0;
  state.nextId = 1;
});

describe("research-company (AC-4, AC-6, AC-14)", () => {
  it("runs the fixture thread end to end and keys every write by the loaded row's ids", async () => {
    seed();
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toEqual({ status: "succeeded" });

    const run = state.tables.research_runs?.[0] as Row;
    expect(run.status).toBe("succeeded");
    expect(run.provider_run_id).toMatch(/^fixture_/);
    expect(run.finished_at).toBeTruthy();
    const summary = run.summary as Row;
    expect(summary).toMatchObject({
      version: 1,
      step: "done",
      processor: "fixture",
      sourcesFound: 5,
      kpisExtracted: 24,
      validation: "skipped",
      promptVersion: "",
    });
    expect(summary.years).toHaveLength(3);
    expect((summary.coverage as Row).ltifr).toBe("found");
    expect(state.tables.company_kpis).toHaveLength(24);
    for (const kpi of state.tables.company_kpis ?? []) {
      expect(kpi).toMatchObject({
        organization_id: ORG,
        company_id: COMPANY,
        research_run_id: RUN,
        source: "research",
        created_by: null,
        confidence: 0.5,
      });
      expect((kpi.sources as unknown[]).length).toBeGreaterThan(0);
    }
    for (const call of writes("research_runs")) {
      expect(call.filters).toEqual(
        expect.arrayContaining([
          ["id", "eq", RUN],
          ["organization_id", "eq", ORG],
          ["company_id", "eq", COMPANY],
        ]),
      );
    }
    const terminal = writes("research_runs").at(-1);
    expect(terminal?.filters).toContainEqual(["status", "eq", "running"]);
    expect(state.tables.companies?.[1]).toMatchObject({ id: OTHER_COMPANY, legal_name: null });
  });

  it("resumes a running run from the stored provider run, never resets the status, and still succeeds when every row exists", async () => {
    seed({
      status: "running",
      provider_run_id: "fixture_TXVzdGVyIEFH",
      started_at: new Date().toISOString(),
      summary: { version: 1, step: "searching" },
    });
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    expect(state.createRuns).toBe(0);
    expect(state.tables.company_kpis).toHaveLength(24);
    const statusWrites = writes("research_runs").filter(
      (call) => (call.patch as Row)?.status !== undefined,
    );
    expect(statusWrites.map((call) => (call.patch as Row).status)).toEqual(["succeeded"]);

    // A second attempt on the finished rows: all inserts conflict, the run still counts them.
    seed({
      status: "running",
      provider_run_id: "fixture_TXVzdGVyIEFH",
      started_at: new Date().toISOString(),
    });
    (state.tables.company_kpis as Row[]).push(
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `existing-${index}`,
        research_run_id: RUN,
        company_id: COMPANY,
        organization_id: ORG,
        kpi_key: [
          "ltifr",
          "trifr",
          "fatalities",
          "lost_days_per_incident",
          "accident_rate_per_1000_fte",
          "absenteeism_rate",
          "near_miss_rate",
          "iso_45001_certified",
        ][index % 8],
        period_year: new Date().getUTCFullYear() - 1 - Math.floor(index / 8),
      })),
    );
    const again = await task.run({ runId: RUN }, { ctx });
    expect(again).toEqual({ status: "succeeded" });
    expect(state.tables.company_kpis).toHaveLength(24);
  });

  it("ends empty when the fixture finds nothing and does nothing on a finished run", async () => {
    seed();
    (state.tables.companies?.[0] as Row).name = "Empty AG";
    const task = await loadTask();
    expect(await task.run({ runId: RUN }, { ctx })).toEqual({ status: "empty" });
    expect(state.tables.company_kpis).toHaveLength(0);
    const before = state.calls.length;
    expect(await task.run({ runId: RUN }, { ctx })).toEqual({ status: "empty" });
    expect(writes("research_runs").length).toBe(writes("research_runs").length);
    expect(state.calls.slice(before).every((call) => call.op === "select")).toBe(true);
  });

  it("stops without a terminal write when the sweep closed the run mid save (the race)", async () => {
    seed();
    state.onKpiInsert = () => {
      const run = state.tables.research_runs?.[0] as Row;
      run.status = "failed";
      run.error_code = "stale";
    };
    const task = await loadTask();
    expect(await task.run({ runId: RUN }, { ctx })).toEqual({ status: "closed_elsewhere" });
    const run = state.tables.research_runs?.[0] as Row;
    expect(run.status).toBe("failed");
    expect(run.error_code).toBe("stale");
    expect(run.finished_at).toBeNull();
  });

  it("throws the retryable class for the fixture fail name with the provider_unavailable prefix", async () => {
    seed();
    (state.tables.companies?.[0] as Row).name = "Fail AG";
    const task = await loadTask();
    await expect(task.run({ runId: RUN }, { ctx })).rejects.toThrow(/^provider_unavailable: /);
    const run = state.tables.research_runs?.[0] as Row;
    expect(run.status).toBe("running");
    expect(run.provider_run_id).toBeNull();
  });
});

describe("the failure hook (AC-10)", () => {
  it("records the error code and message once, guarded by the open statuses, and alerts with the Trigger.dev link", async () => {
    seed({ status: "running", started_at: new Date().toISOString() });
    const task = await loadTask();
    await task.onFailure({
      payload: { runId: RUN },
      error: new Error("provider_timeout: no result within 20 minutes"),
      ctx,
    });
    const run = state.tables.research_runs?.[0] as Row;
    expect(run).toMatchObject({
      status: "failed",
      error_code: "provider_timeout",
      error_message: "The research did not finish within 20 minutes.",
    });
    expect(run.finished_at).toBeTruthy();
    expect(state.alerts).toEqual([
      {
        kind: "research.run_failed",
        fields: {
          runId: RUN,
          organizationName: "Org A",
          reason: "provider_timeout: The research did not finish within 20 minutes.",
        },
        externalUrl: "https://cloud.trigger.dev/projects/v3/proj_test/runs/run_trigger_1",
        idempotencyKey: `research-failed/${RUN}`,
      },
    ]);

    await task.onFailure({ payload: { runId: RUN }, error: new Error("boom"), ctx });
    expect(state.alerts).toHaveLength(1);
    expect(run.error_code).toBe("provider_timeout");
  });

  it("maps an unknown error to internal", async () => {
    seed();
    const task = await loadTask();
    await task.onFailure({
      payload: { runId: RUN },
      error: new Error("maxDuration exceeded"),
      ctx,
    });
    expect(state.tables.research_runs?.[0]).toMatchObject({
      status: "failed",
      error_code: "internal",
    });
  });
});
