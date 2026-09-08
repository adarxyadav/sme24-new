// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  COMPANIES_PAGE_SIZE,
  expertNames,
  listAssignableExperts,
  listCompanies,
  listOpsCounts,
  listOpsQueue,
  listScheduledAssessments,
} from "@/features/ops-admin/queries";
import { afterCursorFilter, decodeCursor } from "@/lib/supabase/cursor";

/**
 * The ops admin reads (spec 0014, AC-1, AC-10, AC-11). Each runs with the caller's own client, so
 * RLS is the boundary and nothing here re asserts it; what these lock in is the shaping the
 * queries do on top of the rows — the keyset cursor carrying both halves of the sort key, the
 * latest run picked per company from one batched read, the orders tally counted in one pass, and
 * the rows the reads deliberately skip.
 *
 * The stub records the filters each query put on the builder, so the parts that must not regress —
 * the `status = 'paid'` and `scheduled_at <= now()` filters that keep the overview on its partial
 * indexes, and the head only counts — are asserted rather than assumed.
 */

/** One table's answer and the filters the query put on it. */
type Answer = { data: unknown; error: unknown; count?: number };

/**
 * A stub of the PostgREST builder that answers per table and records every filter. Each `from()`
 * takes the next answer queued for that table, so a query reading one table twice for different
 * questions is answered separately.
 */
function stubClient(answers: Record<string, Answer | Answer[]>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const queues = new Map<string, Answer[]>(
    Object.entries(answers).map(([table, answer]) => [
      table,
      Array.isArray(answer) ? [...answer] : [answer],
    ]),
  );

  const from = (table: string) => {
    const queue = queues.get(table) ?? [];
    const answer =
      queue.length > 1 ? (queue.shift() as Answer) : (queue[0] ?? { data: [], error: null });
    const record =
      (method: string) =>
      (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
    const builder: Record<string, unknown> = {
      select: record("select"),
      eq: record("eq"),
      in: record("in"),
      is: record("is"),
      or: record("or"),
      lte: record("lte"),
      order: record("order"),
      limit: record("limit"),
      // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable Supabase query builder
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: answer.data, error: answer.error, count: answer.count }),
    };
    return builder;
  };

  return { supabase: { from } as never, calls };
}

/** Every filter one table's query recorded, as `method:column` pairs. */
const filtersOn = (calls: { table: string; method: string; args: unknown[] }[], table: string) =>
  calls
    .filter((call) => call.table === table)
    .map((call) => `${call.method}:${String(call.args[0])}`);

const ORG_ID = "0e000000-0000-4000-8000-000000000004";
const TIED_AT = "2030-01-01T12:00:00.000Z";

describe("listAssignableExperts (AC-3)", () => {
  it("offers only active experts, by name, flattening the joined profile", async () => {
    const { supabase, calls } = stubClient({
      expert_profiles: {
        data: [
          { expert_id: "e2", headline: "Chemicals", profiles: { full_name: "Zoe Zwahlen" } },
          { expert_id: "e1", headline: null, profiles: { full_name: "Anna Aebi" } },
          { expert_id: "e3", headline: "Machines", profiles: null },
        ],
        error: null,
      },
    });

    const experts = await listAssignableExperts(supabase);

    expect(experts.map((expert) => expert.fullName)).toEqual([null, "Anna Aebi", "Zoe Zwahlen"]);
    expect(experts[1]).toEqual({ expertId: "e1", fullName: "Anna Aebi", headline: null });
    // The picker is only a hint; the status filter is still what keeps a deactivated expert out of it.
    expect(filtersOn(calls, "expert_profiles")).toContain("eq:status");
  });

  it("throws on a database error rather than answering an empty list", async () => {
    const { supabase } = stubClient({
      expert_profiles: { data: null, error: { message: "boom", code: "42501" } },
    });
    await expect(listAssignableExperts(supabase)).rejects.toThrow();
  });
});

describe("expertNames", () => {
  it("reads the page's ids in one query and leaves an unreadable profile out of the map", async () => {
    const { supabase, calls } = stubClient({
      profiles: { data: [{ id: "e1", full_name: "Anna Aebi" }], error: null },
    });
    const names = await expertNames(supabase, ["e1", "e1", "e2"]);
    expect(names.get("e1")).toBe("Anna Aebi");
    expect(names.has("e2")).toBe(false);
    expect(filtersOn(calls, "profiles")).toContain("in:id");
  });

  it("asks nothing at all when the page has no assigned expert", async () => {
    const { supabase, calls } = stubClient({});
    expect((await expertNames(supabase, [])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});

describe("listScheduledAssessments (AC-10)", () => {
  it("returns each order with its own date and its own expert, soonest first", async () => {
    const { supabase, calls } = stubClient({
      orders: {
        data: [
          {
            id: "o1",
            reference: "SME24-2026-0001",
            package_name_snapshot: "Safety Culture",
            status: "scheduled",
            scheduled_at: "2030-02-01T08:00:00.000Z",
            assigned_expert_id: "e1",
          },
          {
            id: "o2",
            reference: "SME24-2026-0002",
            package_name_snapshot: "Compliance Check",
            status: "in_progress",
            scheduled_at: "2030-03-01T08:00:00.000Z",
            assigned_expert_id: "e2",
          },
        ],
        error: null,
      },
    });

    const assessments = await listScheduledAssessments(supabase);

    // Two orders in one organization each carry their own expert, never a shared one.
    expect(assessments.map((row) => [row.orderId, row.expertId])).toEqual([
      ["o1", "e1"],
      ["o2", "e2"],
    ]);
    expect(filtersOn(calls, "orders")).toContain("in:status");
  });

  it("skips a row missing either column rather than rendering a card without a date", async () => {
    const { supabase } = stubClient({
      orders: {
        data: [
          {
            id: "o1",
            reference: "R1",
            package_name_snapshot: "P",
            status: "scheduled",
            scheduled_at: null,
            assigned_expert_id: "e1",
          },
          {
            id: "o2",
            reference: "R2",
            package_name_snapshot: "P",
            status: "scheduled",
            scheduled_at: "2030-02-01T08:00:00.000Z",
            assigned_expert_id: null,
          },
          {
            id: "o3",
            reference: "R3",
            package_name_snapshot: "P",
            status: "delivered",
            scheduled_at: "2030-02-01T08:00:00.000Z",
            assigned_expert_id: "e3",
          },
        ],
        error: null,
      },
    });
    const assessments = await listScheduledAssessments(supabase);
    expect(assessments.map((row) => row.orderId)).toEqual(["o3"]);
  });
});

describe("listCompanies (AC-1)", () => {
  /** `COMPANIES_PAGE_SIZE + 1` companies sharing one `created_at`, so the tie spans the boundary. */
  const tiedCompanies = () =>
    Array.from({ length: COMPANIES_PAGE_SIZE + 1 }, (_, index) => ({
      id: `0e000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      name: `Company ${index + 1}`,
      organization_id: ORG_ID,
      canton: "ZH",
      employees_count: 100,
      archived_at: null,
      created_at: TIED_AT,
      organizations: { name: "Musterfirma AG" },
    }));

  it("pages on both halves of the sort key, so tied timestamps are not skipped", async () => {
    const { supabase } = stubClient({
      companies: { data: tiedCompanies(), error: null },
      research_runs: { data: [], error: null },
    });

    const page = await listCompanies(supabase, null);

    expect(page.rows).toHaveLength(COMPANIES_PAGE_SIZE);
    // A cursor carrying the bare timestamp would skip every row tied with it.
    expect(decodeCursor(page.nextCursor ?? undefined)).toEqual({
      createdAt: TIED_AT,
      id: page.rows[COMPANIES_PAGE_SIZE - 1]?.id,
    });
  });

  it("offers no next page when the last page is short", async () => {
    const { supabase } = stubClient({
      companies: { data: tiedCompanies().slice(0, 3), error: null },
      research_runs: { data: [], error: null },
    });
    expect((await listCompanies(supabase, null)).nextCursor).toBeNull();
  });

  it("takes the newest run per company from one batched read, and leaves the rest absent", async () => {
    const { supabase, calls } = stubClient({
      companies: { data: tiedCompanies().slice(0, 2), error: null },
      research_runs: {
        data: [
          // Newest first, so the first sighting of a company id is its latest run.
          {
            company_id: "0e000000-0000-4000-8000-000000000001",
            status: "failed",
            created_at: "2030-05-01T00:00:00.000Z",
          },
          {
            company_id: "0e000000-0000-4000-8000-000000000001",
            status: "succeeded",
            created_at: "2030-01-01T00:00:00.000Z",
          },
        ],
        error: null,
      },
    });

    const page = await listCompanies(supabase, null);

    expect(page.rows[0]?.latestRunStatus).toBe("failed");
    expect(page.rows[0]?.latestRunAt).toBe("2030-05-01T00:00:00.000Z");
    // The second company has never had a run, so it reads as absent rather than as a stale status.
    expect(page.rows[1]?.latestRunStatus).toBeNull();
    // One batched read over the page's ids, never one query per row.
    expect(filtersOn(calls, "research_runs")).toEqual(expect.arrayContaining(["in:company_id"]));
    expect(
      calls.filter((call) => call.table === "research_runs" && call.method === "select"),
    ).toHaveLength(1);
  });

  it("continues from a cursor with the keyset filter, not with the timestamp alone", async () => {
    const first = stubClient({
      companies: { data: tiedCompanies(), error: null },
      research_runs: { data: [], error: null },
    });
    const cursor = (await listCompanies(first.supabase, null)).nextCursor;

    const second = stubClient({
      companies: { data: [], error: null },
      research_runs: { data: [], error: null },
    });
    await listCompanies(second.supabase, cursor);

    const or = second.calls.find((call) => call.table === "companies" && call.method === "or");
    // The `or` filter is what reaches past the rows tied on `created_at`, by naming `id` too.
    expect(or?.args[0]).toBe(afterCursorFilter(decodeCursor(cursor ?? undefined) as never));
    expect(String(or?.args[0])).toContain("id.lt.");
  });

  it("asks for no keyset filter on the first page", async () => {
    const { supabase, calls } = stubClient({
      companies: { data: [], error: null },
      research_runs: { data: [], error: null },
    });
    await listCompanies(supabase, null);
    expect(calls.some((call) => call.table === "companies" && call.method === "or")).toBe(false);
  });

  it("falls back to a dash when the organization name cannot be read", async () => {
    const rows = tiedCompanies()
      .slice(0, 1)
      .map((row) => ({ ...row, organizations: null }));
    const { supabase } = stubClient({
      companies: { data: rows, error: null },
      research_runs: { data: [], error: null },
    });
    expect((await listCompanies(supabase, null)).rows[0]?.organizationName).toBe("—");
  });

  it("throws on a database error", async () => {
    const { supabase } = stubClient({
      companies: { data: null, error: { message: "boom", code: "42501" } },
    });
    await expect(listCompanies(supabase, null)).rejects.toThrow();
  });
});

describe("listOpsQueue (AC-11)", () => {
  const emptyQueue = {
    orders: [
      { data: [], error: null },
      { data: [], error: null },
    ],
    enquiries: { data: [], error: null },
    email_deliveries: { data: [], error: null },
    research_runs: { data: [], error: null },
  };

  it("reads the two order sections on their own filters, so both ride the partial indexes", async () => {
    const { supabase, calls } = stubClient(emptyQueue);

    await listOpsQueue(supabase);

    const orders = filtersOn(calls, "orders");
    // The unscheduled section: status = 'paid', the partial index's own predicate.
    expect(orders).toContain("eq:status");
    // The overdue section: status in ('scheduled','in_progress') and scheduled_at <= now().
    expect(orders).toContain("in:status");
    expect(orders).toContain("lte:scheduled_at");
    // The comparison instant is absolute, decided by the query, not by a zone conversion here.
    const lte = calls.find((call) => call.table === "orders" && call.method === "lte");
    expect(new Date(lte?.args[1] as string).toISOString()).toBe(lte?.args[1]);
  });

  it("answers five empty sections when nothing is waiting", async () => {
    const { supabase } = stubClient(emptyQueue);
    const queue = await listOpsQueue(supabase);
    expect(queue).toEqual({
      unscheduledOrders: [],
      overdueOrders: [],
      newEnquiries: [],
      failedDeliveries: [],
      failedRuns: [],
    });
  });

  it("shapes each of the five sections, falling back to a dash on an unreadable join", async () => {
    const { supabase } = stubClient({
      orders: [
        {
          data: [
            {
              id: "o1",
              reference: "SME24-2026-0001",
              package_name_snapshot: "Safety Culture",
              paid_at: "2030-01-01T00:00:00.000Z",
              organizations: { name: "Musterfirma AG" },
            },
          ],
          error: null,
        },
        {
          data: [
            {
              id: "o2",
              reference: "SME24-2026-0002",
              package_name_snapshot: "Compliance Check",
              status: "in_progress",
              scheduled_at: "2030-01-02T00:00:00.000Z",
              organizations: null,
            },
            // Missing the date the filter already compared: skipped rather than rendered.
            {
              id: "o3",
              reference: "R3",
              package_name_snapshot: "P",
              status: "scheduled",
              scheduled_at: null,
              organizations: null,
            },
          ],
          error: null,
        },
      ],
      enquiries: {
        data: [{ id: "q1", company_name: "Beta AG", created_at: "2030-01-03T00:00:00.000Z" }],
        error: null,
      },
      email_deliveries: {
        data: [
          {
            id: "d1",
            template: "welcome",
            status: "bounced",
            created_at: "2030-01-04T00:00:00.000Z",
          },
        ],
        error: null,
      },
      research_runs: {
        data: [
          {
            id: "r1",
            company_id: "c1",
            error_code: "internal",
            created_at: "2030-01-05T00:00:00.000Z",
            companies: null,
          },
        ],
        error: null,
      },
    });

    const queue = await listOpsQueue(supabase);

    expect(queue.unscheduledOrders[0]).toEqual({
      id: "o1",
      reference: "SME24-2026-0001",
      packageName: "Safety Culture",
      organizationName: "Musterfirma AG",
      paidAt: "2030-01-01T00:00:00.000Z",
    });
    expect(queue.overdueOrders.map((row) => row.id)).toEqual(["o2"]);
    expect(queue.overdueOrders[0]?.organizationName).toBe("—");
    expect(queue.newEnquiries[0]?.companyName).toBe("Beta AG");
    expect(queue.failedDeliveries[0]?.status).toBe("bounced");
    expect(queue.failedRuns[0]).toMatchObject({ errorCode: "internal", companyName: "—" });
  });

  it("throws when any one of the five reads fails, rather than showing a partial queue", async () => {
    const { supabase } = stubClient({
      ...emptyQueue,
      email_deliveries: { data: null, error: { message: "boom", code: "42501" } },
    });
    await expect(listOpsQueue(supabase)).rejects.toThrow();
  });
});

describe("listOpsCounts (AC-11)", () => {
  it("tallies the orders in one pass and counts the rest without shipping rows", async () => {
    const { supabase, calls } = stubClient({
      companies: { data: null, error: null, count: 42 },
      research_runs: { data: null, error: null, count: 3 },
      expert_profiles: { data: null, error: null, count: 7 },
      orders: {
        data: [
          { status: "paid" },
          { status: "paid" },
          { status: "scheduled" },
          { status: "delivered" },
          { status: "paid" },
        ],
        error: null,
      },
    });

    const counts = await listOpsCounts(supabase);

    expect(counts.companies).toBe(42);
    expect(counts.openResearchRuns).toBe(3);
    expect(counts.activeExperts).toBe(7);
    expect(counts.ordersByStatus.get("paid")).toBe(3);
    expect(counts.ordersByStatus.get("scheduled")).toBe(1);
    // A status with no rows is absent rather than zero, which is what the tiles render off.
    expect(counts.ordersByStatus.has("refunded")).toBe(false);
    // One grouped read of the status column, never one count per status.
    expect(
      calls.filter((call) => call.table === "orders" && call.method === "select"),
    ).toHaveLength(1);
    // Only the open runs and the active experts are filtered; companies are counted whole.
    expect(filtersOn(calls, "research_runs")).toContain("in:status");
    expect(filtersOn(calls, "expert_profiles")).toContain("eq:status");
  });

  it("reads a null count as zero", async () => {
    const { supabase } = stubClient({
      companies: { data: null, error: null },
      research_runs: { data: null, error: null },
      expert_profiles: { data: null, error: null },
      orders: { data: null, error: null },
    });
    const counts = await listOpsCounts(supabase);
    expect(counts).toMatchObject({ companies: 0, openResearchRuns: 0, activeExperts: 0 });
    expect(counts.ordersByStatus.size).toBe(0);
  });

  it("throws when a count fails", async () => {
    const { supabase } = stubClient({
      companies: { data: null, error: null, count: 1 },
      research_runs: { data: null, error: null, count: 0 },
      expert_profiles: { data: null, error: { message: "boom", code: "42501" } },
      orders: { data: [], error: null },
    });
    await expect(listOpsCounts(supabase)).rejects.toThrow();
  });
});
