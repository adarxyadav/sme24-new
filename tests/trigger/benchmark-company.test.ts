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
type Payload = typeof payload;

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
