// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The benchmark-company task against fakes (spec 0008, AC-5, AC-8): a failed query surfaces as
 * a real `Error` carrying the PostgREST message (supabase-js hands back a plain object at
 * runtime, and a thrown plain object retries, reaches Sentry and the failure hook without a
 * message or a stack), and the failure hook puts that message, never "[object Object]", into
 * the `benchmark.failed` alert. The SDK, the env, the service client, Sentry, the alert, the
 * email task and the research task's link helper are the boundaries.
 */
type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Tables whose next query answers `{ data: null, error }` with this raw PostgREST body. */
  failing: {} as Record<string, Row>,
  alerts: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  queue: (options: unknown) => options,
  idempotencyKeys: { create: vi.fn(async (key: string) => key) },
  logger: { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@sentry/node", () => ({ captureException: vi.fn(), init: vi.fn(), flush: vi.fn() }));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/trigger/ops-alert", () => ({
  raiseAlertFromTask: async (alert: Record<string, unknown>) => {
    state.alerts.push(alert);
  },
}));
vi.mock("@/trigger/research-company", () => ({
  triggerRunUrl: (ref: string, id: string) => `https://cloud.trigger.dev/${ref}/${id}`,
}));
vi.mock("@/trigger/send-email", () => ({
  sendEmailTask: { trigger: vi.fn(async () => ({ id: "run_email" })) },
}));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase() }));

const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";

/** What supabase-js returns for a failed query: the parsed PostgREST body, not an `Error`. */
const RAW_POSTGREST_ERROR = { message: "JWT expired", code: "PGRST301", details: null, hint: null };

type Filter = [column: string, value: unknown];

function fakeSupabase() {
  return { from: (table: string) => builder(table) };
}

function builder(table: string) {
  const filters: Filter[] = [];
  let op = "select";
  let inserted: Row[] = [];
  const rows = () => (state.tables[table] ??= []);
  const execute = () => {
    const failure = state.failing[table];
    if (failure) return { data: null, error: failure };
    if (op === "insert") {
      const stored = inserted.map((row) => ({
        id: `s${state.nextId++}`,
        created_at: new Date().toISOString(),
        ...row,
      }));
      rows().push(...stored);
      return { data: stored, error: null };
    }
    const found = rows().filter((row) => filters.every(([column, value]) => row[column] === value));
    return { data: found, error: null };
  };
  const chain = {
    select: () => chain,
    insert: (value: Row | Row[]) => {
      op = "insert";
      inserted = Array.isArray(value) ? value : [value];
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push([column, value]);
      return chain;
    },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
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

const ctx = { run: { id: "run_trigger_1" }, attempt: { number: 1 }, project: { ref: "proj_test" } };
const payload = { companyId: COMPANY, triggerKind: "recompute" as const };
type Payload = {
  companyId: string;
  triggerKind: "research" | "client_edit" | "recompute";
  researchRunId?: string;
};

async function loadTask() {
  const module = await import("@/trigger/benchmark-company");
  return module.benchmarkCompanyTask as unknown as {
    run: (input: Payload, options: { ctx: typeof ctx }) => Promise<Row>;
    onFailure: (input: { payload: Payload; error: unknown; ctx: typeof ctx }) => Promise<void>;
  };
}

beforeEach(() => {
  state.tables = {
    organizations: [{ id: ORG, name: "Org A" }],
    companies: [
      {
        id: COMPANY,
        organization_id: ORG,
        name: "Muster AG",
        archived_at: null,
        employees_count: null,
        industry_code: null,
        updated_at: "2026-09-06T10:00:00.000Z",
      },
    ],
  };
  state.failing = {};
  state.alerts = [];
  state.nextId = 1;
});

describe("benchmark-company failures", () => {
  it("throws a real Error carrying the PostgREST message when a query fails, so the retry and Sentry see it", async () => {
    state.failing.companies = RAW_POSTGREST_ERROR;
    const task = await loadTask();
    const failure = await task.run(payload, { ctx }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("JWT expired");
    expect(String(failure)).toContain("JWT expired");
  });

  it("puts the message of a plain object error into the benchmark.failed alert, never [object Object]", async () => {
    const task = await loadTask();
    await task.onFailure({ payload, error: RAW_POSTGREST_ERROR, ctx });
    expect(state.alerts).toHaveLength(1);
    expect(state.alerts[0]).toMatchObject({
      kind: "benchmark.failed",
      fields: {
        organizationName: "Org A",
        companyName: "Muster AG",
        triggerKind: "recompute",
        errorMessage: "JWT expired",
      },
      externalUrl: "https://cloud.trigger.dev/proj_test/run_trigger_1",
      idempotencyKey: "benchmark-failed/run_trigger_1",
    });
  });

  it("keeps an Error's message in the alert and falls back to a fixed reason for an empty one", async () => {
    const task = await loadTask();
    await task.onFailure({ payload, error: new Error("connection reset"), ctx });
    await task.onFailure({ payload, error: "", ctx });
    expect(state.alerts.map((alert) => (alert.fields as Row).errorMessage)).toEqual([
      "connection reset",
      "unknown error",
    ]);
  });
});

/** The stored rows a computation reads (AC-5): the active catalogue, the company's KPIs, the peers and the assumptions. */
function seedComputation() {
  state.tables.kpi_definitions = [
    {
      key: "accident_rate_per_1000_fte",
      direction: "lower_is_better",
      sort_order: 10,
      is_active: true,
    },
    { key: "ltifr", direction: "lower_is_better", sort_order: 20, is_active: true },
    {
      key: "lost_days_per_incident",
      direction: "lower_is_better",
      sort_order: 30,
      is_active: true,
    },
    { key: "retired_kpi", direction: "lower_is_better", sort_order: 40, is_active: false },
  ];
  state.tables.company_kpi_current = [
    {
      id: "0f000000-0000-4000-8000-000000000001",
      company_id: COMPANY,
      organization_id: ORG,
      kpi_key: "accident_rate_per_1000_fte",
      value: "68",
      period_year: 2025,
      source: "research",
      confidence: "0.9",
      research_run_id: RUN,
    },
    {
      id: "0f000000-0000-4000-8000-000000000002",
      company_id: COMPANY,
      organization_id: ORG,
      kpi_key: "ltifr",
      value: "2.4",
      period_year: 2025,
      source: "research",
      confidence: "0.8",
      research_run_id: RUN,
    },
    // Another company's row must never leak into this computation.
    {
      id: "0f000000-0000-4000-8000-000000000009",
      company_id: OTHER_COMPANY,
      organization_id: ORG,
      kpi_key: "lost_days_per_incident",
      value: "40",
      period_year: 2025,
      source: "client",
      confidence: null,
      research_run_id: null,
    },
  ];
  state.tables.benchmarks = [
    {
      id: "0b000000-0000-4000-8000-000000000001",
      kpi_key: "accident_rate_per_1000_fte",
      industry_section: "ALL",
      size_band: "all",
      period_year: 2022,
      p25: "25",
      median: "61.8",
      p75: "81.2",
      sample_size: null,
      provisional: true,
    },
    {
      id: "0b000000-0000-4000-8000-000000000002",
      kpi_key: "ltifr",
      industry_section: "ALL",
      size_band: "all",
      period_year: 2022,
      p25: "1",
      median: "2",
      p75: "4",
      sample_size: 300,
      provisional: false,
    },
  ];
  state.tables.benchmark_assumptions = [
    ["hours_per_fte", "1804", "hours per year"],
    ["direct_cost_per_case_chf", "4811", "CHF per case"],
    ["cost_per_absence_day_chf", "1100", "CHF per day"],
    ["lost_days_per_incident_default", "14", "days per case"],
    ["indirect_multiplier_low", "2", "factor"],
    ["indirect_multiplier", "3.7", "factor"],
    ["indirect_multiplier_high", "5", "factor"],
  ].map(([key, value, unit]) => ({
    key,
    value,
    unit,
    source_name: "test",
    source_url: null,
    provisional: true,
    effective_from: "2022-12-31",
  }));
  state.tables.organization_members = [
    { organization_id: ORG, user_id: MEMBER_A },
    { organization_id: ORG, user_id: MEMBER_B },
    { organization_id: OTHER_ORG, user_id: "11111111-1111-4111-8111-111111111199" },
  ];
  state.tables.benchmark_snapshots = [];
}

const RUN = "0d000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000000";
const OTHER_COMPANY = "0c000000-0000-4000-8000-00000000000b";
const MEMBER_A = "11111111-1111-4111-8111-111111111111";
const MEMBER_B = "11111111-1111-4111-8111-111111111112";

async function emailTrigger() {
  const { sendEmailTask } = await import("@/trigger/send-email");
  return vi.mocked(sendEmailTask.trigger);
}

describe("benchmark-company computes and stores a snapshot (AC-5)", () => {
  it("skips a missing company and an archived one without writing a row", async () => {
    seedComputation();
    const task = await loadTask();
    expect(await task.run({ companyId: OTHER_COMPANY, triggerKind: "recompute" }, { ctx })).toEqual(
      {
        status: "skipped",
      },
    );
    (state.tables.companies?.[0] as Row).archived_at = "2026-09-06T09:00:00.000Z";
    expect(await task.run(payload, { ctx })).toEqual({ status: "skipped" });
    expect(state.tables.benchmark_snapshots).toHaveLength(0);
    expect((await emailTrigger()).mock.calls).toHaveLength(0);
  });

  it("stores one row keyed by the loaded company and organization with the version 1 blocks and the scalars", async () => {
    seedComputation();
    (state.tables.companies?.[0] as Row).employees_count = 420;
    (state.tables.companies?.[0] as Row).industry_code = "23.61";
    const task = await loadTask();
    const outcome = await task.run(
      { companyId: COMPANY, triggerKind: "research", researchRunId: RUN },
      { ctx },
    );
    expect(outcome).toMatchObject({ status: "stored", first: true });
    const stored = state.tables.benchmark_snapshots?.[0] as Row;
    expect(stored).toMatchObject({
      id: outcome.snapshotId,
      organization_id: ORG,
      company_id: COMPANY,
      research_run_id: RUN,
      trigger_kind: "research",
      model_version: "benchmark-model@1",
      peer_provisional: true,
      kpis_compared: 2,
      confidence: 0.9,
    });
    expect(stored.cost_chf).toBeGreaterThan(0);
    expect(stored.cost_low_chf).toBeLessThan(stored.cost_chf as number);
    expect(stored.cost_high_chf).toBeGreaterThan(stored.cost_chf as number);
    const inputs = stored.inputs as Row;
    expect(inputs).toMatchObject({
      fte: 420,
      section: "C",
      sizeBand: "250+",
      industryCode: "23.61",
      companyUpdatedAt: "2026-09-06T10:00:00.000Z",
    });
    // Only this company's rows, and only catalogue keys, reach the model.
    expect((inputs.kpis as Row[]).map((kpi) => kpi.key)).toEqual([
      "accident_rate_per_1000_fte",
      "ltifr",
    ]);
    expect((stored.results as Row[]).map((result) => result.key)).toEqual([
      "accident_rate_per_1000_fte",
      "ltifr",
    ]);
    expect((stored.cost as Row).incidentKpi).toBe("accident_rate_per_1000_fte");
    expect((stored.cost as Row).lostDaysSource).toBe("default");
    expect((stored.assumptions as Row[]).map((assumption) => assumption.key)).not.toContain(
      "hours_per_fte",
    );
  });

  it("stores no research run on a client edit and a recompute", async () => {
    seedComputation();
    const task = await loadTask();
    await task.run({ companyId: COMPANY, triggerKind: "client_edit", researchRunId: RUN }, { ctx });
    await task.run(payload, { ctx });
    expect(state.tables.benchmark_snapshots?.map((row) => row.research_run_id)).toEqual([
      null,
      null,
    ]);
    expect(state.tables.benchmark_snapshots?.map((row) => row.trigger_kind)).toEqual([
      "client_edit",
      "recompute",
    ]);
  });

  it("stores a snapshot with nothing compared and no cost when the company has no KPI rows", async () => {
    seedComputation();
    state.tables.company_kpi_current = [];
    const task = await loadTask();
    const outcome = await task.run(payload, { ctx });
    expect(outcome).toMatchObject({ status: "stored" });
    expect(state.tables.benchmark_snapshots?.[0]).toMatchObject({
      kpis_compared: 0,
      cost_chf: null,
      confidence: null,
      results: [],
      gaps: [],
      cost: null,
      assumptions: [],
    });
  });
});

describe("the benchmark ready email (AC-7)", () => {
  it("queues one email per member of the organization on the first snapshot, with rounded money and a stable key", async () => {
    seedComputation();
    (state.tables.companies?.[0] as Row).employees_count = 420;
    const task = await loadTask();
    const outcome = await task.run(payload, { ctx });
    const trigger = await emailTrigger();
    expect(trigger).toHaveBeenCalledTimes(2);
    const stored = state.tables.benchmark_snapshots?.[0] as Row;
    for (const [index, userId] of [MEMBER_A, MEMBER_B].entries()) {
      const [sendPayload, options] = trigger.mock.calls[index] as unknown as [Row, Row];
      expect(sendPayload).toEqual({
        kind: "new",
        template: "benchmark_ready",
        data: {
          companyName: "Muster AG",
          kpisCompared: 2,
          costChf: expect.any(Number),
          savingMedianChf: expect.any(Number),
        },
        recipient: { userId },
        sourceEvent: "benchmark.snapshot_created",
        organizationId: ORG,
        idempotencyKey: `benchmark-ready/${COMPANY}/${userId}`,
      });
      expect((sendPayload.data as Row).costChf).not.toBe(stored.cost_chf);
      expect(((sendPayload.data as Row).costChf as number) % 100).toBe(0);
      expect(options).toEqual({
        idempotencyKey: `benchmark-ready/${COMPANY}/${userId}`,
        idempotencyKeyTTL: "30d",
      });
    }
    expect(outcome).toMatchObject({ first: true });
  });

  it("leaves the money out of the email when no cost was computed", async () => {
    seedComputation();
    const task = await loadTask();
    await task.run(payload, { ctx });
    const trigger = await emailTrigger();
    const [sendPayload] = trigger.mock.calls[0] as unknown as [Row];
    expect(sendPayload.data).toEqual({ companyName: "Muster AG", kpisCompared: 2 });
  });

  it("sends nothing for a second snapshot of the same company", async () => {
    seedComputation();
    const task = await loadTask();
    await task.run(payload, { ctx });
    const trigger = await emailTrigger();
    trigger.mockClear();
    const outcome = await task.run(payload, { ctx });
    expect(outcome).toMatchObject({ status: "stored", first: false });
    expect(trigger).not.toHaveBeenCalled();
    expect(state.tables.benchmark_snapshots).toHaveLength(2);
  });

  it("keeps the snapshot and finishes when an email trigger fails", async () => {
    seedComputation();
    const trigger = await emailTrigger();
    trigger.mockRejectedValueOnce(new Error("trigger down"));
    const task = await loadTask();
    const outcome = await task.run(payload, { ctx });
    expect(outcome).toMatchObject({ status: "stored", first: true });
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(state.tables.benchmark_snapshots).toHaveLength(1);
  });
});
