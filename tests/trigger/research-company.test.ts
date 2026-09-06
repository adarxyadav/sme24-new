// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The research-company task against fakes (spec 0007, AC-4, AC-6, AC-10, AC-14): every write is
 * keyed by the ids of the run row it loaded, a resumed attempt reuses the stored provider run and
 * never resets the status, a run closed by the sweep mid save stops without a terminal write, the
 * failure hook records the error code once and raises the alert with the Trigger.dev link, and
 * the fixture `fail` name throws the retryable class. A passed validation fills the company facts
 * only where the column is still null and lands in the summary; the budget and a provider run
 * reported as failed abort with their codes; every step logs the run's ids (AC-15). The SDK, the
 * env, the service client, the fixture pauses, the validation call and the alert are the
 * boundaries; validation is skipped unless a test sets an outcome.
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
  /** Every `tasks.trigger` call: the task id, its payload and its options (spec 0008, AC-6). */
  triggers: [] as Array<{ id: string; payload: unknown; options: unknown }>,
  /** When set, the next `tasks.trigger` rejects with this message. */
  triggerFailure: null as null | string,
  onKpiInsert: null as null | (() => void),
  /** Fires after a `company_kpis` select, so a test can land a concurrent row mid save. */
  onKpiSelect: null as null | (() => void),
  createRuns: 0,
  nextId: 1,
  /** What the fixture's poll answers when set (the provider reporting the run as failed). */
  providerStatus: null as null | "running" | "done" | "failed",
  /** The validation outcome the pass answers; null means skipped. */
  validation: null as null | {
    verdicts: Map<string, Record<string, unknown>>;
    facts: Record<string, unknown>;
    promptVersion: string;
  },
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  queue: (options: unknown) => options,
  tasks: {
    onFailure: vi.fn(),
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
        createRun: async (...args: Parameters<typeof provider.createRun>) => {
          state.createRuns += 1;
          return provider.createRun(...args);
        },
        getRun: async (providerRunId: string) =>
          state.providerStatus ? { status: state.providerStatus } : provider.getRun(providerRunId),
      };
    },
  };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase() }));
vi.mock("@/lib/research/validate", () => ({
  validateResearch: async () => state.validation,
}));

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
      if (table === "company_kpis") state.onKpiSelect?.();
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
  state.onKpiSelect = null;
  state.createRuns = 0;
  state.nextId = 1;
  state.providerStatus = null;
  state.validation = null;
  state.triggers = [];
  state.triggerFailure = null;
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

  it("retries only the rows another attempt did not store while the bulk insert was in flight", async () => {
    seed({
      status: "running",
      provider_run_id: "fixture_TXVzdGVyIEFH",
      started_at: new Date().toISOString(),
    });
    // The up front read sees nothing, then a concurrent attempt stores one slot, so the bulk
    // insert conflicts; the fallback must re-read and skip that slot rather than retry all 24.
    const year = new Date().getUTCFullYear() - 1;
    state.onKpiSelect = () => {
      state.onKpiSelect = null;
      (state.tables.company_kpis as Row[]).push({
        id: "raced",
        research_run_id: RUN,
        company_id: COMPANY,
        organization_id: ORG,
        kpi_key: "ltifr",
        period_year: year,
      });
    };
    const task = await loadTask();
    await expect(task.run({ runId: RUN }, { ctx })).resolves.toEqual({ status: "succeeded" });
    expect(state.tables.company_kpis).toHaveLength(24);

    const inserts = state.calls.filter(
      (call) => call.table === "company_kpis" && call.op === "insert",
    );
    // The bulk insert, the re-read, then 23 single rows: the raced slot is never retried.
    expect(inserts).toHaveLength(1 + 23);
    const retried = inserts.slice(1).map((call) => (call.patch as Row[])[0]);
    expect(retried).toHaveLength(23);
    expect(retried.some((row) => row?.kpi_key === "ltifr" && row?.period_year === year)).toBe(
      false,
    );
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

describe("the abort paths (AC-4, AC-10)", () => {
  it("fails at once with provider_timeout when the attempt starts past the 20 minute budget, without a provider run", async () => {
    seed({
      status: "running",
      started_at: new Date(Date.now() - 21 * 60 * 1000).toISOString(),
      summary: { version: 1, step: "searching" },
    });
    const task = await loadTask();
    await expect(task.run({ runId: RUN }, { ctx })).rejects.toThrow(/^provider_timeout: /);
    expect(state.createRuns).toBe(0);
    expect(state.tables.research_runs?.[0]).toMatchObject({ status: "running" });
  });

  it("aborts with provider_rejected when the provider reports the run as failed", async () => {
    seed();
    state.providerStatus = "failed";
    const task = await loadTask();
    await expect(task.run({ runId: RUN }, { ctx })).rejects.toThrow(/^provider_rejected: /);
    const run = state.tables.research_runs?.[0] as Row;
    expect(run.status).toBe("running");
    expect(run.provider_run_id).toMatch(/^fixture_/);
    expect(state.tables.company_kpis).toHaveLength(0);
  });

  it("aborts when the run row does not exist", async () => {
    seed();
    const task = await loadTask();
    await expect(
      task.run({ runId: "0d000000-0000-4000-8000-0000000000ff" }, { ctx }),
    ).rejects.toThrow(/^internal: research run .* not found/);
  });
});

describe("a passed validation (AC-5, AC-6)", () => {
  it("keeps the supported verdicts, records the rest as dropped, fills only the null company facts and marks the summary passed", async () => {
    seed();
    (state.tables.companies?.[0] as Row).canton = "BE";
    state.validation = {
      verdicts: new Map([
        ["ltifr_latest", { supported: true, value: 2.4, periodYear: 2025, confidence: 0.85 }],
        ["ltifr_previous", { supported: true, value: 2.7, periodYear: 2024, confidence: 0.7 }],
        ["trifr_latest", { supported: false, value: 6.1, periodYear: 2025, confidence: 0.9 }],
      ]),
      facts: { legalName: "Example Fixture AG", uid: "CHE-123.456.789", canton: "ZH" },
      promptVersion: "research-validation@1",
    };
    const task = await loadTask();
    expect(await task.run({ runId: RUN }, { ctx })).toEqual({ status: "succeeded" });

    const kpis = state.tables.company_kpis as Row[];
    expect(kpis.map((row) => [row.kpi_key, row.period_year, row.value, row.confidence])).toEqual([
      ["ltifr", 2025, 2.4, 0.85],
      ["ltifr", 2024, 2.7, 0.7],
    ]);
    const finishedRun = state.tables.research_runs?.[0] as Row;
    const summary = finishedRun.summary as Row;
    expect(summary).toMatchObject({
      validation: "passed",
      promptVersion: "research-validation@1",
      kpisExtracted: 2,
      companyFacts: { legalName: "Example Fixture AG", uid: "CHE-123.456.789", canton: "ZH" },
    });
    expect((summary.coverage as Row).ltifr).toBe("found");
    expect((summary.coverage as Row).trifr).toBe("not_found");
    const dropped = summary.dropped as Array<{ key: string; reason: string }>;
    expect(dropped).toHaveLength(22);
    expect(dropped.every((entry) => entry.reason === "unsupported")).toBe(true);

    // The facts fill only null columns: the canton the client already set stays.
    expect(state.tables.companies?.[0]).toMatchObject({
      legal_name: "Example Fixture AG",
      uid: "CHE-123.456.789",
      canton: "BE",
    });
    for (const call of writes("companies")) {
      expect(call.filters).toEqual(
        expect.arrayContaining([
          ["id", "eq", COMPANY],
          ["organization_id", "eq", ORG],
        ]),
      );
      expect(call.filters.some(([, op]) => op === "is")).toBe(true);
    }
    expect(state.tables.companies?.[1]).toMatchObject({ id: OTHER_COMPANY, legal_name: null });
  });
});

describe("the step logs (AC-15)", () => {
  it("writes one structured line per step carrying the run's ids, the provider run id and the elapsed time", async () => {
    seed();
    const lines: Array<Record<string, unknown>> = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      try {
        lines.push(JSON.parse(line));
      } catch {
        // not one of ours
      }
    });
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    spy.mockRestore();

    const ours = lines.filter((line) => line.runId === RUN);
    expect(ours.map((line) => line.msg)).toEqual([
      "research attempt started",
      "provider run created",
      "provider result received",
      "values resolved",
      "research run finished",
      "benchmark queued after the research run",
    ]);
    for (const line of ours) {
      expect(line).toMatchObject({ level: "info", organizationId: ORG, companyId: COMPANY });
    }
    // The five research steps carry the elapsed time; the benchmark line (spec 0008, AC-6) names the queued run instead.
    const steps = ours.slice(0, 5);
    for (const line of steps) expect(typeof line.elapsedMs).toBe("number");
    expect(ours.at(-1)).toMatchObject({ benchmarkRunId: "run_1" });
    const finished = steps.at(-1) as Row;
    expect(finished.providerRunId).toMatch(/^fixture_/);
    expect(finished).toMatchObject({ status: "succeeded", stored: 24 });
    expect(typeof finished.totalMs).toBe("number");
  });
});

describe("the helpers (AC-10)", () => {
  it("builds the Trigger.dev run page from the project ref and the run id", async () => {
    const { triggerRunUrl } = await import("@/trigger/research-company");
    expect(triggerRunUrl("proj_abc", "run_123")).toBe(
      "https://cloud.trigger.dev/projects/v3/proj_abc/runs/run_123",
    );
  });

  it("reads the error code from the abort prefix, the error class, else internal", async () => {
    const { errorCodeOf } = await import("@/trigger/research-company");
    const { ProviderRejectedError, ProviderUnavailableError } = await import(
      "@/lib/research/provider"
    );
    expect(errorCodeOf(new Error("provider_timeout: no result within 20 minutes"))).toBe(
      "provider_timeout",
    );
    expect(errorCodeOf(new Error("provider_rejected: 401"))).toBe("provider_rejected");
    expect(errorCodeOf(new Error("provider_unavailable: 503"))).toBe("provider_unavailable");
    expect(errorCodeOf(new ProviderUnavailableError("network"))).toBe("provider_unavailable");
    expect(errorCodeOf(new ProviderRejectedError("nope"))).toBe("provider_rejected");
    expect(errorCodeOf(new Error("provider_timeouts are fun"))).toBe("internal");
    expect(errorCodeOf(new Error("maxDuration exceeded"))).toBe("internal");
    expect(errorCodeOf("a string")).toBe("internal");
    expect(errorCodeOf(undefined)).toBe("internal");
  });
});

describe("the benchmark trigger after the run (spec 0008, AC-6)", () => {
  it("queues benchmark-company once the run ended succeeded, keyed by the run, with a 24 hour TTL", async () => {
    seed();
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    expect(state.triggers).toEqual([
      {
        id: "benchmark-company",
        payload: { companyId: COMPANY, triggerKind: "research", researchRunId: RUN },
        options: { idempotencyKey: `benchmark/run/${RUN}`, idempotencyKeyTTL: "24h" },
      },
    ]);
  });

  it("queues nothing when the run ends empty", async () => {
    seed();
    (state.tables.companies?.[0] as Row).name = "Empty AG";
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toEqual({ status: "empty" });
    expect(state.triggers).toEqual([]);
  });

  it("queues nothing when the sweep closed the run before the terminal write", async () => {
    seed();
    state.onKpiInsert = () => {
      (state.tables.research_runs?.[0] as Row).status = "failed";
    };
    const task = await loadTask();
    await task.run({ runId: RUN }, { ctx });
    expect(state.triggers).toEqual([]);
  });

  it("keeps the run succeeded and reports to Sentry when the trigger fails", async () => {
    seed();
    state.triggerFailure = "trigger down";
    const Sentry = await import("@sentry/node");
    const task = await loadTask();
    const result = await task.run({ runId: RUN }, { ctx });
    expect(result).toEqual({ status: "succeeded" });
    const run = state.tables.research_runs?.[0] as Row;
    expect(run.status).toBe("succeeded");
    expect(state.triggers).toEqual([]);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.objectContaining({ message: "trigger down" }),
      expect.objectContaining({ extra: expect.objectContaining({ runId: RUN }) }),
    );
  });
});
