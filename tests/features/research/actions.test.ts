// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two research actions (spec 0007, AC-3, AC-8, AC-9, AC-14): both refuse anyone but a client
 * with an organization claim, parse their input with the feature schema, insert the company and
 * the queued run with the caller's ids, trigger `research-company` under `research/<runId>`, store
 * the Trigger.dev run id, map the two policy errors, and close the run as `trigger_failed` while
 * still answering `ok` when the trigger call fails. The action client, the Trigger.dev SDK, the
 * env and Sentry are the boundaries; the tables are an in memory store.
 */
type Row = Record<string, unknown>;
type Filter = [column: string, op: string, value: unknown];

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  env: {} as Record<string, unknown>,
  tables: {} as Record<string, Row[]>,
  calls: [] as Array<{ table: string; op: string; filters: Filter[]; payload?: unknown }>,
  errors: {} as Partial<Record<string, { code?: string; message: string; details?: string }>>,
  trigger: vi.fn<(id: string, payload: unknown, options: unknown) => Promise<{ id: string }>>(),
  createKey: vi.fn(async (key: string, options: unknown) => ({ key, options })),
  captureException: vi.fn(),
  nextId: 1,
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: (table: string) => builder(table),
  }),
}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: boundary.trigger },
  idempotencyKeys: { create: boundary.createKey },
}));
vi.mock("@/lib/env", () => ({ serverEnv: () => boundary.env }));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every(([column, op, value]) => {
    if (op === "eq") return row[column] === value;
    if (op === "is") return row[column] === value;
    return true;
  });
}

/** A PostgREST like builder over the in memory tables: filters are recorded per call. */
function builder(table: string) {
  const filters: Filter[] = [];
  let op = "select";
  let payload: Row | undefined;
  const rows = () => (boundary.tables[table] ??= []);
  const execute = (): { data: Row[] | null; error: unknown } => {
    boundary.calls.push({ table, op, filters: [...filters], payload });
    const injected = boundary.errors[`${table}.${op}`];
    if (injected) return { data: null, error: injected };
    if (op === "select")
      return { data: rows().filter((row) => matches(row, filters)), error: null };
    if (op === "insert") {
      const inserted = { id: `${table}-${boundary.nextId++}`, ...(payload as Row) };
      rows().push(inserted);
      return { data: [inserted], error: null };
    }
    const found = rows().filter((row) => matches(row, filters));
    for (const row of found) Object.assign(row, payload);
    return { data: found, error: null };
  };
  const chain = {
    select: () => chain,
    insert: (value: Row) => {
      op = "insert";
      payload = value;
      return chain;
    },
    update: (value: Row) => {
      op = "update";
      payload = value;
      return chain;
    },
    eq: (column: string, value: unknown) => {
      filters.push([column, "eq", value]);
      return chain;
    },
    is: (column: string, value: unknown) => {
      filters.push([column, "is", value]);
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const result = execute();
      return { data: result.data?.[0] ?? null, error: result.error };
    },
    single: async () => {
      const result = execute();
      return { data: result.data?.[0] ?? null, error: result.error };
    },
    // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(execute()).then(resolve, reject),
  };
  return chain;
}

const { requestResearch, rerunResearch } = await import("@/features/research/actions");

const USER = "a0000000-0000-4000-8000-000000000002";
const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const client = { sub: USER, app_metadata: { role: "client", organization_id: ORG } };
const AT = new Date("2026-09-06T10:00:00Z");

const lookup = { name: " Muster AG ", website: "Muster.ch/reports", locale: "de-CH" };
const rerun = {
  companyId: COMPANY,
  name: "Muster Holding",
  legalName: "",
  website: "www.muster.ch",
  locale: "en-CH",
};

function seedCompany() {
  boundary.tables.companies = [
    { id: COMPANY, organization_id: ORG, name: "Muster AG", archived_at: null },
  ];
}

function calls(table: string, op: string) {
  return boundary.calls.filter((call) => call.table === table && call.op === op);
}

beforeEach(() => {
  boundary.claims = client;
  boundary.env = { TRIGGER_SECRET_KEY: "tr_test" };
  boundary.tables = {};
  boundary.calls = [];
  boundary.errors = {};
  boundary.nextId = 1;
  boundary.trigger.mockResolvedValue({ id: "run_trigger_1" });
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("the client role check (AC-14)", () => {
  it.each([
    ["an expert", { sub: USER, app_metadata: { role: "expert", organization_id: ORG } }],
    ["an ops user", { sub: USER, app_metadata: { role: "ops" } }],
    ["a client without an organization", { sub: USER, app_metadata: { role: "client" } }],
    [
      "a top level role claim",
      { sub: USER, role: "client", app_metadata: { organization_id: ORG } },
    ],
    ["client claims without a subject", { app_metadata: { role: "client", organization_id: ORG } }],
    ["a signed out visitor", null],
  ])("refuses %s on both actions without reading or triggering anything", async (_, claims) => {
    boundary.claims = claims;
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    await expect(rerunResearch(null, rerun)).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(boundary.calls).toEqual([]);
    expect(boundary.trigger).not.toHaveBeenCalled();
  });
});

describe("requestResearch (AC-3)", () => {
  it("creates the company and the queued run with the caller's ids, triggers the task under the run key and stores the run id", async () => {
    const result = await requestResearch(null, lookup);
    expect(result).toEqual({
      ok: true,
      data: { companyId: "companies-1", runId: "research_runs-2" },
    });

    expect(calls("companies", "insert")[0]?.payload).toEqual({
      organization_id: ORG,
      name: "Muster AG",
      website: "https://muster.ch",
      country: "CH",
      created_by: USER,
    });
    expect(calls("research_runs", "insert")[0]?.payload).toEqual({
      organization_id: ORG,
      company_id: "companies-1",
      requested_by: USER,
      status: "queued",
    });
    expect(boundary.createKey).toHaveBeenCalledWith("research/research_runs-2", {
      scope: "global",
    });
    expect(boundary.trigger).toHaveBeenCalledWith(
      "research-company",
      { runId: "research_runs-2" },
      {
        idempotencyKey: { key: "research/research_runs-2", options: { scope: "global" } },
        idempotencyKeyTTL: "24h",
      },
    );
    expect(boundary.tables.research_runs?.[0]).toMatchObject({
      status: "queued",
      trigger_run_id: "run_trigger_1",
    });
    expect(calls("research_runs", "update")[0]?.filters).toEqual([["id", "eq", "research_runs-2"]]);
  });

  it("looks for the organization's non archived company before inserting", async () => {
    await requestResearch(null, lookup);
    expect(calls("companies", "select")[0]?.filters).toEqual([
      ["organization_id", "eq", ORG],
      ["archived_at", "is", null],
    ]);
  });

  it("answers company_exists with the id when the organization already has a company, and inserts nothing", async () => {
    seedCompany();
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: false,
      error: "company_exists",
      companyId: COMPANY,
    });
    expect(calls("companies", "insert")).toEqual([]);
    expect(calls("research_runs", "insert")).toEqual([]);
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("stores no website when none was typed", async () => {
    await requestResearch(null, { name: "Muster AG", website: "", locale: "en-CH" });
    expect(calls("companies", "insert")[0]?.payload).toMatchObject({ website: null });
  });

  it.each([
    ["a name of one character", { name: "A", website: "" }],
    ["a name over 200 characters", { name: "x".repeat(201), website: "" }],
    ["a website that is not a host", { name: "Muster AG", website: "??" }],
    ["no input at all", null],
  ])("rejects %s as validation before touching the database", async (_, input) => {
    await expect(requestResearch(null, input)).resolves.toEqual({
      ok: false,
      error: "validation",
    });
    expect(boundary.calls).toEqual([]);
  });

  it("reports an unexpected error on the company lookup to Sentry", async () => {
    boundary.errors["companies.select"] = { code: "XX000", message: "connection lost" };
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "connection lost" }),
      expect.objectContaining({ tags: { source: "request-research" } }),
    );
  });

  it("keeps the company when the run insert fails and answers with the mapped error (AC-9)", async () => {
    boundary.errors["research_runs.insert"] = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "research_runs_one_open_per_company_idx"',
      details: "Key (company_id)=(companies-1) already exists.",
    };
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: false,
      error: "run_in_progress",
    });
    expect(boundary.tables.companies).toHaveLength(1);
    expect(boundary.trigger).not.toHaveBeenCalled();
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("maps a row level security violation on the run insert to the quota (AC-9)", async () => {
    boundary.errors["research_runs.insert"] = {
      code: "42501",
      message: 'new row violates row-level security policy for table "research_runs"',
    };
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: false,
      error: "quota_exceeded",
    });
    expect(boundary.captureException).not.toHaveBeenCalled();
  });

  it("treats another unique violation on the run insert as unexpected and reports it", async () => {
    boundary.errors["research_runs.insert"] = {
      code: "23505",
      message: 'duplicate key value violates unique constraint "research_runs_pkey"',
    };
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: false,
      error: "unexpected",
    });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("a failed trigger (AC-3)", () => {
  it("closes the run as trigger_failed with a finish time and still answers ok with the run id", async () => {
    boundary.trigger.mockRejectedValue(new Error("Trigger.dev unreachable"));
    await expect(requestResearch(null, lookup)).resolves.toEqual({
      ok: true,
      data: { companyId: "companies-1", runId: "research_runs-2" },
    });
    expect(boundary.tables.research_runs?.[0]).toMatchObject({
      status: "failed",
      error_code: "trigger_failed",
      error_message: "The research could not be started.",
      finished_at: AT.toISOString(),
    });
    expect(boundary.tables.research_runs?.[0]?.trigger_run_id).toBeUndefined();
  });

  it("takes the same path without a Trigger.dev key, never calling the SDK", async () => {
    boundary.env = {};
    await expect(requestResearch(null, lookup)).resolves.toMatchObject({ ok: true });
    expect(boundary.trigger).not.toHaveBeenCalled();
    expect(boundary.tables.research_runs?.[0]).toMatchObject({ error_code: "trigger_failed" });
  });

  it("reports the trigger error to Sentry only when deployed", async () => {
    boundary.trigger.mockRejectedValue(new Error("Trigger.dev unreachable"));
    await requestResearch(null, lookup);
    expect(boundary.captureException).not.toHaveBeenCalled();

    vi.stubEnv("VERCEL_ENV", "preview");
    boundary.tables = {};
    boundary.nextId = 1;
    await requestResearch(null, lookup);
    expect(boundary.captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Trigger.dev unreachable" }),
      {
        tags: { source: "trigger", task: "research-company", research_run_id: "research_runs-2" },
        extra: { organizationId: ORG },
      },
    );
  });
});

describe("rerunResearch (AC-8, AC-14)", () => {
  it("updates the editable columns of the caller's company and starts the next run", async () => {
    seedCompany();
    await expect(rerunResearch(null, rerun)).resolves.toEqual({
      ok: true,
      data: { runId: "research_runs-1" },
    });
    const update = calls("companies", "update")[0];
    expect(update?.payload).toEqual({
      name: "Muster Holding",
      legal_name: null,
      website: "https://www.muster.ch",
    });
    expect(update?.filters).toEqual([
      ["id", "eq", COMPANY],
      ["organization_id", "eq", ORG],
      ["archived_at", "is", null],
    ]);
    expect(calls("research_runs", "insert")[0]?.payload).toEqual({
      organization_id: ORG,
      company_id: COMPANY,
      requested_by: USER,
      status: "queued",
    });
    expect(boundary.trigger).toHaveBeenCalledWith(
      "research-company",
      { runId: "research_runs-1" },
      expect.anything(),
    );
  });

  it("keeps a typed legal name", async () => {
    seedCompany();
    await rerunResearch(null, { ...rerun, legalName: " Muster Holding AG " });
    expect(calls("companies", "update")[0]?.payload).toMatchObject({
      legal_name: "Muster Holding AG",
    });
  });

  it("answers not_found for a company outside the caller's organization and inserts no run", async () => {
    boundary.tables.companies = [
      { id: COMPANY, organization_id: "0b000000-0000-4000-8000-000000000000", archived_at: null },
    ];
    await expect(rerunResearch(null, rerun)).resolves.toEqual({ ok: false, error: "not_found" });
    expect(calls("research_runs", "insert")).toEqual([]);
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("answers not_found for an archived company", async () => {
    boundary.tables.companies = [
      { id: COMPANY, organization_id: ORG, archived_at: "2026-09-01T00:00:00.000Z" },
    ];
    await expect(rerunResearch(null, rerun)).resolves.toEqual({ ok: false, error: "not_found" });
  });

  it("rejects a company id that is not a uuid before touching the database", async () => {
    await expect(rerunResearch(null, { ...rerun, companyId: "1" })).resolves.toEqual({
      ok: false,
      error: "validation",
    });
    expect(boundary.calls).toEqual([]);
  });

  it("maps an open run on the rerun insert to run_in_progress", async () => {
    seedCompany();
    boundary.errors["research_runs.insert"] = {
      code: "23505",
      message:
        'duplicate key value violates unique constraint "research_runs_one_open_per_company_idx"',
    };
    await expect(rerunResearch(null, rerun)).resolves.toEqual({
      ok: false,
      error: "run_in_progress",
    });
  });
});
