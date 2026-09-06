// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getCompanyDashboard, newestYears } from "@/features/research/queries";

/**
 * The dashboard query (spec 0007, AC-7, AC-8): the organization's oldest non archived company,
 * the latest run with its parsed summary, the effective KPI rows narrowed to the three newest
 * years and joined to their run's validation flag in a second query, the active catalogue in sort
 * order and the daily quota (trigger_failed rows excluded, the open run id). The Supabase client
 * is the boundary: a recorder that answers per table.
 */
type Row = Record<string, unknown>;
type Call = { table: string; steps: Array<[string, unknown[]]> };

const ORG = "0a000000-0000-4000-8000-000000000000";
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const RUN_PASSED = "0d000000-0000-4000-8000-000000000001";
const RUN_SKIPPED = "0d000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-06T10:00:00.000Z");

type Answers = Record<string, (call: Call) => { data?: unknown; error?: unknown; count?: number }>;

/** A fake client: each `from(table)` call records its chain and answers from `answers[table]`. */
function fakeClient(answers: Answers) {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      from: (table: string) => {
        const call: Call = { table, steps: [] };
        calls.push(call);
        const finish = () => {
          const answer = answers[table]?.(call) ?? { data: [] };
          return {
            data: answer.data ?? null,
            error: answer.error ?? null,
            count: answer.count ?? null,
          };
        };
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "is", "in", "gt", "or", "order", "limit"]) {
          chain[method] = (...args: unknown[]) => {
            call.steps.push([method, args]);
            return chain;
          };
        }
        chain.maybeSingle = async () => {
          call.steps.push(["maybeSingle", []]);
          const result = finish();
          return { data: (result.data as Row[] | null)?.[0] ?? null, error: result.error };
        };
        // biome-ignore lint/suspicious/noThenProperty: the fake mimics PostgREST's thenable builder
        chain.then = (
          resolve: (value: unknown) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(finish()).then(resolve, reject);
        return chain;
      },
    },
  };
}

const company = { id: COMPANY, organization_id: ORG, name: "Muster AG", archived_at: null };
const catalogue = [
  { key: "ltifr", sort_order: 1, is_active: true },
  { key: "trifr", sort_order: 2, is_active: true },
];

function kpi(overrides: Row): Row {
  return {
    company_id: COMPANY,
    kpi_key: "ltifr",
    period_year: 2025,
    value: 2.4,
    confidence: 0.9,
    research_run_id: RUN_PASSED,
    sources: [],
    ...overrides,
  };
}

/** Distinguishes the count query from the open run query on `research_runs`. */
function isCount(call: Call) {
  return call.steps.some(
    ([method, args]) => method === "select" && (args[1] as Row)?.head === true,
  );
}

function baseAnswers(overrides: Partial<Answers> = {}): Answers {
  return {
    companies: () => ({ data: [company] }),
    kpi_definitions: () => ({ data: catalogue }),
    research_runs: (call) => {
      if (isCount(call)) return { count: 2 };
      if (call.steps.some(([method, args]) => method === "in" && args[0] === "id")) {
        return {
          data: [
            { id: RUN_PASSED, summary: { version: 1, step: "done", validation: "passed" } },
            { id: RUN_SKIPPED, summary: { version: 1, step: "done", validation: "skipped" } },
          ],
        };
      }
      if (call.steps.some(([method]) => method === "order")) {
        return {
          data: [
            {
              id: RUN_PASSED,
              company_id: COMPANY,
              status: "succeeded",
              summary: { version: 1, step: "done", sourcesFound: 5 },
            },
          ],
        };
      }
      return { data: [{ id: RUN_PASSED }] };
    },
    company_kpi_current: () => ({
      data: [
        kpi({ period_year: 2025 }),
        kpi({ period_year: 2024, research_run_id: RUN_SKIPPED }),
        kpi({ period_year: 2023, kpi_key: "trifr", research_run_id: null }),
        kpi({ period_year: 2022 }),
        kpi({ period_year: null }),
      ],
    }),
    ...overrides,
  };
}

describe("newestYears (AC-7)", () => {
  it("keeps the three highest distinct years, newest first, ignoring null years", () => {
    expect(
      newestYears([
        { period_year: 2022 },
        { period_year: 2025 },
        { period_year: null },
        { period_year: 2025 },
        { period_year: 2023 },
        { period_year: 2024 },
      ]),
    ).toEqual([2025, 2024, 2023]);
  });

  it("gives fewer years when fewer exist, and none for no rows", () => {
    expect(newestYears([{ period_year: 2021 }])).toEqual([2021]);
    expect(newestYears([])).toEqual([]);
  });
});

describe("getCompanyDashboard (AC-7, AC-8)", () => {
  it("returns the empty dashboard with the catalogue and the quota when the organization has no company", async () => {
    const { client, calls } = fakeClient(
      baseAnswers({
        companies: () => ({ data: [] }),
        research_runs: (call) => (isCount(call) ? { count: 0 } : { data: [] }),
      }),
    );
    const dashboard = await getCompanyDashboard(client as never, ORG, NOW);
    expect(dashboard).toEqual({
      company: null,
      latestRun: null,
      kpis: [],
      years: [],
      catalogue,
      quota: { used: 0, limit: 5, remaining: 5, openRunId: null },
    });
    expect(calls.map((call) => call.table).sort()).toEqual([
      "companies",
      "kpi_definitions",
      "research_runs",
      "research_runs",
    ]);
  });

  it("selects the organization's oldest non archived company and the active catalogue in sort order", async () => {
    const { client, calls } = fakeClient(baseAnswers());
    await getCompanyDashboard(client as never, ORG, NOW);
    const companies = calls.find((call) => call.table === "companies");
    expect(companies?.steps).toEqual([
      ["select", ["*"]],
      ["eq", ["organization_id", ORG]],
      ["is", ["archived_at", null]],
      ["order", ["created_at", { ascending: true }]],
      ["order", ["id", { ascending: true }]],
      ["limit", [1]],
      ["maybeSingle", []],
    ]);
    const definitions = calls.find((call) => call.table === "kpi_definitions");
    expect(definitions?.steps).toEqual([
      ["select", ["*"]],
      ["eq", ["is_active", true]],
      ["order", ["sort_order", { ascending: true }]],
    ]);
  });

  it("narrows the rows to the three newest years and joins each row to its run's validation flag", async () => {
    const { client, calls } = fakeClient(baseAnswers());
    const dashboard = await getCompanyDashboard(client as never, ORG, NOW);
    expect(dashboard.years).toEqual([2025, 2024, 2023]);
    expect(dashboard.kpis.map((row) => [row.period_year, row.validation])).toEqual([
      [2025, "passed"],
      [2024, "skipped"],
      [2023, "passed"],
    ]);
    const validation = calls.find(
      (call) =>
        call.table === "research_runs" &&
        call.steps.some(([method, args]) => method === "in" && args[0] === "id"),
    );
    expect(validation?.steps).toEqual([
      ["select", ["id, summary"]],
      ["in", ["id", [RUN_PASSED, RUN_SKIPPED]]],
    ]);
  });

  it("parses the latest run's summary and keeps null for a summary of another shape", async () => {
    const { client } = fakeClient(baseAnswers());
    const dashboard = await getCompanyDashboard(client as never, ORG, NOW);
    expect(dashboard.latestRun).toMatchObject({
      id: RUN_PASSED,
      status: "succeeded",
      parsedSummary: { version: 1, step: "done", sourcesFound: 5 },
    });

    const odd = fakeClient(
      baseAnswers({
        research_runs: (call) =>
          isCount(call)
            ? { count: 0 }
            : call.steps.some(([method]) => method === "order")
              ? { data: [{ id: RUN_PASSED, status: "queued", summary: { version: 9 } }] }
              : { data: [] },
      }),
    );
    const queued = await getCompanyDashboard(odd.client as never, ORG, NOW);
    expect(queued.latestRun?.parsedSummary).toBeNull();
  });

  it("counts the last 24 hours without trigger_failed rows and reports the open run", async () => {
    const { client, calls } = fakeClient(baseAnswers());
    const dashboard = await getCompanyDashboard(client as never, ORG, NOW);
    expect(dashboard.quota).toEqual({ used: 2, limit: 5, remaining: 3, openRunId: RUN_PASSED });
    const count = calls.find((call) => call.table === "research_runs" && isCount(call));
    expect(count?.steps).toEqual([
      ["select", ["id", { count: "exact", head: true }]],
      ["eq", ["organization_id", ORG]],
      ["gt", ["created_at", "2026-09-05T10:00:00.000Z"]],
      ["or", ["error_code.is.null,error_code.neq.trigger_failed"]],
    ]);
    const open = calls.find(
      (call) =>
        call.table === "research_runs" &&
        call.steps.some(([method, args]) => method === "in" && args[0] === "status"),
    );
    expect(open?.steps).toContainEqual(["in", ["status", ["queued", "running"]]]);
  });

  it("never reports a negative remainder when the quota was overshot", async () => {
    const { client } = fakeClient(
      baseAnswers({
        research_runs: (call) => (isCount(call) ? { count: 6 } : { data: [] }),
        company_kpi_current: () => ({ data: [] }),
      }),
    );
    const dashboard = await getCompanyDashboard(client as never, ORG, NOW);
    expect(dashboard.quota).toMatchObject({ used: 6, remaining: 0, openRunId: null });
  });

  it("throws a real Error when supabase-js answers with its plain error object (E394 regression)", async () => {
    // At runtime the `error` is the parsed PostgREST body, not a `PostgrestError` instance; a
    // thrown plain object reached the error boundary as "[object Object]".
    const raw = { message: "JWT expired", code: "PGRST301", details: null, hint: null };
    const { client } = fakeClient(baseAnswers({ research_runs: () => ({ error: raw }) }));
    const thrown = await getCompanyDashboard(client as never, ORG, NOW).then(
      () => null,
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ message: "JWT expired", code: "PGRST301" });
  });

  it("throws on a database error instead of rendering a half dashboard", async () => {
    const { client } = fakeClient(
      baseAnswers({ company_kpi_current: () => ({ error: new Error("permission denied") }) }),
    );
    await expect(getCompanyDashboard(client as never, ORG, NOW)).rejects.toThrow(
      "permission denied",
    );
  });
});
