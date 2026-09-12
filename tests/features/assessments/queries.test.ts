// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  getAssessment,
  getNewestVersion,
  listAssessmentStates,
  listAssessments,
  listExpertBookings,
  toAssessmentItem,
} from "@/features/assessments/queries";

/**
 * The assessment reads (spec 0019, AC-5, AC-6, AC-10). RLS is the boundary and nothing here
 * re asserts it; what these lock in is the shaping on top of the rows: the id guard before any
 * read, the pinned version resolved from the row, the items filtered to that version before the
 * score, a score only for a submitted assessment whose answers came back, the newest version by
 * number, and the state map keyed by order that reads `assessments` alone and never an answer.
 */
type Answer = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

/** A stub of the PostgREST builder answering per table in order and recording every call. */
function stubClient(answers: Record<string, Answer | Answer[]>) {
  const calls: Call[] = [];
  const queues = new Map<string, Answer[]>(
    Object.entries(answers).map(([table, answer]) => [
      table,
      Array.isArray(answer) ? [...answer] : [answer],
    ]),
  );
  const from = (table: string) => {
    const queue = queues.get(table) ?? [];
    const answer =
      queue.length > 1 ? (queue.shift() as Answer) : (queue[0] ?? { data: null, error: null });
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
      order: record("order"),
      limit: record("limit"),
      maybeSingle: record("maybeSingle"),
      // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable Supabase query builder
      then: (resolve: (value: unknown) => unknown) =>
        resolve({ data: answer.data, error: answer.error }),
    };
    return builder;
  };
  return { supabase: { from } as never, calls };
}

const tablesRead = (calls: Call[]) => [...new Set(calls.map((call) => call.table))];
const argsOf = (calls: Call[], table: string, method: string) =>
  calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);

const ORG_ID = "0e000000-0000-4000-8000-000000000002";
const COMPANY_ID = "0e000000-0000-4000-8000-000000000003";
const ORDER_ID = "0e000000-0000-4000-8000-000000000004";
const OTHER_ORDER_ID = "0e000000-0000-4000-8000-000000000044";
const ASSESSMENT_ID = "0e000000-0000-4000-8000-000000000005";
const DRAFT_ID = "0e000000-0000-4000-8000-000000000006";
const EXPERT_ID = "0e000000-0000-4000-8000-000000000001";

const text = (en: string) => ({ de: `${en} (de)`, en });

const VERSION = {
  key: "iso45001@1",
  questionnaire_key: "iso45001",
  version: 1,
  title: text("ISO 45001 Gap Assessment"),
  sections: [{ key: "c4", label: "4", title: text("Context"), groups: [] }],
  item_count: 2,
  source_note: null,
  created_at: "2026-09-12T00:00:00Z",
  updated_at: "2026-09-12T00:00:00Z",
};

const itemRow = (position: number, label: string, versionKey = "iso45001@1") => ({
  id: `${versionKey}/${position}`,
  version_key: versionKey,
  position,
  parent_id: null,
  section_key: "c4",
  group_key: null,
  label,
  rateable: true,
  title: text(`Item ${label}`),
  requirement: null,
  question: text(`Question ${label}`),
  de_reviewed: false,
  created_at: "2026-09-12T00:00:00Z",
  updated_at: "2026-09-12T00:00:00Z",
});
const ITEM_ROWS = [itemRow(1, "4.1"), itemRow(2, "4.2")];

const assessmentRow = (
  id: string,
  status: "draft" | "submitted",
  extra: Record<string, unknown> = {},
) => ({
  id,
  organization_id: ORG_ID,
  company_id: COMPANY_ID,
  order_id: ORDER_ID,
  questionnaire_key: "iso45001",
  questionnaire_version_key: "iso45001@1",
  expert_id: EXPERT_ID,
  status,
  site: null,
  conducted_on: null,
  submitted_at: status === "submitted" ? "2026-09-12T10:00:00Z" : null,
  created_at: status === "submitted" ? "2026-09-11T09:00:00Z" : "2026-09-12T09:00:00Z",
  updated_at: "2026-09-12T09:00:00Z",
  ...extra,
});

describe("toAssessmentItem", () => {
  it("parses the jsonb columns into the model's shape and rejects a malformed text", () => {
    expect(toAssessmentItem(itemRow(1, "4.1") as never)).toEqual({
      id: "iso45001@1/1",
      position: 1,
      parentId: null,
      sectionKey: "c4",
      groupKey: null,
      label: "4.1",
      rateable: true,
      title: text("Item 4.1"),
      requirement: null,
      question: text("Question 4.1"),
      deReviewed: false,
    });
    expect(() =>
      toAssessmentItem({ ...itemRow(1, "4.1"), title: { en: "only" } } as never),
    ).toThrow();
  });
});

describe("getAssessment (AC-6)", () => {
  it("answers null for a malformed id without touching the database", async () => {
    const { supabase, calls } = stubClient({});
    expect(await getAssessment(supabase, "not-a-uuid")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("answers null when RLS hides the row, after reading the assessment alone", async () => {
    const { supabase, calls } = stubClient({ assessments: { data: null, error: null } });
    expect(await getAssessment(supabase, ASSESSMENT_ID)).toBeNull();
    expect(tablesRead(calls)).toEqual(["assessments"]);
    expect(argsOf(calls, "assessments", "eq")).toEqual([["id", ASSESSMENT_ID]]);
  });

  it("assembles the row with its names, the pinned version, its items in position order and the answers", async () => {
    const row = assessmentRow(ASSESSMENT_ID, "draft", {
      companies: { name: "Musterfirma AG" },
      organizations: { name: "Musterfirma Holding" },
    });
    const { supabase, calls } = stubClient({
      assessments: { data: row, error: null },
      questionnaire_versions: { data: VERSION, error: null },
      questionnaire_items: { data: ITEM_ROWS, error: null },
      assessment_answers: {
        data: [{ item_id: "iso45001@1/1", section_key: null, rating: "partial", note: "Seen" }],
        error: null,
      },
    });

    const page = await getAssessment(supabase, ASSESSMENT_ID);

    expect(page?.status).toBe("draft");
    expect(page?.companyName).toBe("Musterfirma AG");
    expect(page?.organizationName).toBe("Musterfirma Holding");
    expect(page?.assessment).not.toHaveProperty("companies");
    expect(page?.version).toEqual({
      key: "iso45001@1",
      questionnaireKey: "iso45001",
      version: 1,
      title: text("ISO 45001 Gap Assessment"),
      sections: VERSION.sections,
    });
    expect(page?.items.map((item) => item.id)).toEqual(["iso45001@1/1", "iso45001@1/2"]);
    expect(page?.answers).toEqual([
      { itemId: "iso45001@1/1", sectionKey: null, rating: "partial", note: "Seen" },
    ]);
    expect(argsOf(calls, "assessments", "select")).toEqual([
      ["*, companies(name), organizations(name)"],
    ]);
    expect(argsOf(calls, "questionnaire_versions", "eq")).toEqual([["key", "iso45001@1"]]);
    expect(argsOf(calls, "questionnaire_items", "in")).toEqual([["version_key", ["iso45001@1"]]]);
    expect(argsOf(calls, "questionnaire_items", "order")).toEqual([
      ["position", { ascending: true }],
    ]);
    expect(argsOf(calls, "assessment_answers", "eq")).toEqual([["assessment_id", ASSESSMENT_ID]]);
  });

  it("reads a submitted status and null names when the joins are hidden", async () => {
    const { supabase } = stubClient({
      assessments: {
        data: assessmentRow(ASSESSMENT_ID, "submitted", { companies: null, organizations: null }),
        error: null,
      },
      questionnaire_versions: { data: VERSION, error: null },
      questionnaire_items: { data: [], error: null },
      assessment_answers: { data: [], error: null },
    });
    const page = await getAssessment(supabase, ASSESSMENT_ID);
    expect(page?.status).toBe("submitted");
    expect(page?.companyName).toBeNull();
    expect(page?.organizationName).toBeNull();
  });

  it("throws when the pinned version is missing, because the foreign key guarantees it", async () => {
    const { supabase } = stubClient({
      assessments: { data: assessmentRow(ASSESSMENT_ID, "draft"), error: null },
      questionnaire_versions: { data: null, error: null },
      questionnaire_items: { data: [], error: null },
      assessment_answers: { data: [], error: null },
    });
    await expect(getAssessment(supabase, ASSESSMENT_ID)).rejects.toThrow(/iso45001@1 is missing/);
  });

  it("throws on a database error rather than answering null", async () => {
    const { supabase } = stubClient({
      assessments: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    await expect(getAssessment(supabase, ASSESSMENT_ID)).rejects.toThrow();
  });
});

describe("listAssessments (AC-5)", () => {
  const listRow = (id: string, status: "draft" | "submitted") => ({
    id,
    company_id: COMPANY_ID,
    expert_id: EXPERT_ID,
    questionnaire_key: "iso45001",
    questionnaire_version_key: "iso45001@1",
    status,
    created_at: status === "submitted" ? "2026-09-11T09:00:00Z" : "2026-09-12T09:00:00Z",
    submitted_at: status === "submitted" ? "2026-09-12T10:00:00Z" : null,
  });

  it("answers an empty list for a malformed id without a read, and for no rows after one", async () => {
    const empty = stubClient({});
    expect(await listAssessments(empty.supabase, "nope")).toEqual([]);
    expect(empty.calls).toEqual([]);

    const none = stubClient({ assessments: { data: [], error: null } });
    expect(await listAssessments(none.supabase, ORG_ID)).toEqual([]);
    expect(tablesRead(none.calls)).toEqual(["assessments"]);
  });

  it("gives every row its title from the version and a score only to a submitted one whose answers came back", async () => {
    const { supabase, calls } = stubClient({
      assessments: {
        data: [listRow(DRAFT_ID, "draft"), listRow(ASSESSMENT_ID, "submitted")],
        error: null,
      },
      questionnaire_versions: { data: [VERSION], error: null },
      questionnaire_items: { data: [...ITEM_ROWS, itemRow(1, "1.1", "compliance@1")], error: null },
      assessment_answers: {
        data: [
          {
            assessment_id: ASSESSMENT_ID,
            item_id: "iso45001@1/1",
            section_key: null,
            rating: "compliant",
            note: null,
          },
          {
            assessment_id: ASSESSMENT_ID,
            item_id: "iso45001@1/2",
            section_key: null,
            rating: "non_compliant",
            note: null,
          },
        ],
        error: null,
      },
    });

    const rows = await listAssessments(supabase, ORG_ID);

    expect(rows.map((row) => [row.id, row.status, row.score])).toEqual([
      [DRAFT_ID, "draft", null],
      [ASSESSMENT_ID, "submitted", 50],
    ]);
    expect(rows[0]).toMatchObject({
      companyId: COMPANY_ID,
      expertId: EXPERT_ID,
      questionnaireKey: "iso45001",
      questionnaireTitle: text("ISO 45001 Gap Assessment"),
      createdAt: "2026-09-12T09:00:00Z",
      submittedAt: null,
    });
    expect(rows[1]?.submittedAt).toBe("2026-09-12T10:00:00Z");
    expect(argsOf(calls, "assessments", "eq")).toEqual([["organization_id", ORG_ID]]);
    expect(argsOf(calls, "assessments", "order")).toEqual([["created_at", { ascending: false }]]);
    expect(argsOf(calls, "assessment_answers", "in")).toEqual([["assessment_id", [ASSESSMENT_ID]]]);
  });

  it("reads neither items nor answers while nothing is submitted", async () => {
    const { supabase, calls } = stubClient({
      assessments: { data: [listRow(DRAFT_ID, "draft")], error: null },
      questionnaire_versions: { data: [VERSION], error: null },
    });
    const rows = await listAssessments(supabase, ORG_ID);
    expect(rows).toHaveLength(1);
    expect(tablesRead(calls).sort()).toEqual(["assessments", "questionnaire_versions"]);
  });

  it("lists a submitted assessment of another expert without a score when its answers are hidden", async () => {
    const { supabase } = stubClient({
      assessments: { data: [listRow(ASSESSMENT_ID, "submitted")], error: null },
      questionnaire_versions: { data: [VERSION], error: null },
      questionnaire_items: { data: ITEM_ROWS, error: null },
      assessment_answers: { data: [], error: null },
    });
    const rows = await listAssessments(supabase, ORG_ID);
    expect(rows[0]?.score).toBeNull();
  });

  it("falls back to the key as the title when the version row did not come back", async () => {
    const { supabase } = stubClient({
      assessments: { data: [listRow(DRAFT_ID, "draft")], error: null },
      questionnaire_versions: { data: [], error: null },
    });
    const rows = await listAssessments(supabase, ORG_ID);
    expect(rows[0]?.questionnaireTitle).toEqual({ de: "iso45001", en: "iso45001" });
  });
});

describe("listExpertBookings (AC-5)", () => {
  it("maps the view rows newest visit first and drops a row missing one of its ids", async () => {
    const { supabase, calls } = stubClient({
      expert_bookings: {
        data: [
          {
            id: ORDER_ID,
            organization_id: ORG_ID,
            company_id: COMPANY_ID,
            reference: "SME24-2026-0042",
            package_key: "compliance",
            package_name_snapshot: "Assessment Plus",
            status: "scheduled",
            scheduled_at: "2026-10-06T07:00:00Z",
            delivered_at: null,
          },
          { id: null, organization_id: ORG_ID, company_id: COMPANY_ID },
          {
            id: OTHER_ORDER_ID,
            organization_id: ORG_ID,
            company_id: COMPANY_ID,
            reference: null,
            package_key: null,
            package_name_snapshot: null,
            status: null,
            scheduled_at: null,
            delivered_at: null,
          },
        ],
        error: null,
      },
    });
    const bookings = await listExpertBookings(supabase, ORG_ID);
    expect(bookings).toEqual([
      {
        id: ORDER_ID,
        organizationId: ORG_ID,
        companyId: COMPANY_ID,
        reference: "SME24-2026-0042",
        packageKey: "compliance",
        packageName: "Assessment Plus",
        status: "scheduled",
        scheduledAt: "2026-10-06T07:00:00Z",
        deliveredAt: null,
      },
      {
        id: OTHER_ORDER_ID,
        organizationId: ORG_ID,
        companyId: COMPANY_ID,
        reference: "",
        packageKey: "",
        packageName: "",
        status: "",
        scheduledAt: null,
        deliveredAt: null,
      },
    ]);
    expect(argsOf(calls, "expert_bookings", "order")).toEqual([
      ["scheduled_at", { ascending: false, nullsFirst: false }],
    ]);
  });

  it("answers an empty list for a malformed id without a read", async () => {
    const { supabase, calls } = stubClient({});
    expect(await listExpertBookings(supabase, "nope")).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("getNewestVersion (AC-5)", () => {
  it("takes the highest version number of the key and attaches its items", async () => {
    const { supabase, calls } = stubClient({
      questionnaire_versions: { data: VERSION, error: null },
      questionnaire_items: { data: ITEM_ROWS, error: null },
    });
    const version = await getNewestVersion(supabase, "iso45001");
    expect(version?.key).toBe("iso45001@1");
    expect(version?.items.map((item) => item.label)).toEqual(["4.1", "4.2"]);
    expect(argsOf(calls, "questionnaire_versions", "eq")).toEqual([
      ["questionnaire_key", "iso45001"],
    ]);
    expect(argsOf(calls, "questionnaire_versions", "order")).toEqual([
      ["version", { ascending: false }],
    ]);
    expect(argsOf(calls, "questionnaire_versions", "limit")).toEqual([[1]]);
  });

  it("answers null when no version is seeded, without reading the items", async () => {
    const { supabase, calls } = stubClient({ questionnaire_versions: { data: null, error: null } });
    expect(await getNewestVersion(supabase, "compliance")).toBeNull();
    expect(tablesRead(calls)).toEqual(["questionnaire_versions"]);
  });
});

describe("listAssessmentStates (AC-10)", () => {
  const stateRow = (orderId: string | null, key: string, status: "draft" | "submitted") => ({
    order_id: orderId,
    questionnaire_key: key,
    status,
    created_at: "2026-09-10T07:30:00Z",
    submitted_at: status === "submitted" ? "2026-09-12T10:20:00Z" : null,
  });

  it("keys the states by order, keeps every row of an order in creation order and skips a row without one", async () => {
    const { supabase, calls } = stubClient({
      assessments: {
        data: [
          stateRow(ORDER_ID, "iso45001", "draft"),
          stateRow(ORDER_ID, "compliance", "submitted"),
          stateRow(null, "iso45001", "draft"),
          stateRow(OTHER_ORDER_ID, "iso45001", "submitted"),
        ],
        error: null,
      },
    });
    const states = await listAssessmentStates(supabase, [ORDER_ID, OTHER_ORDER_ID]);
    expect([...states.keys()]).toEqual([ORDER_ID, OTHER_ORDER_ID]);
    expect(states.get(ORDER_ID)).toEqual([
      {
        orderId: ORDER_ID,
        questionnaireKey: "iso45001",
        status: "draft",
        createdAt: "2026-09-10T07:30:00Z",
        submittedAt: null,
      },
      {
        orderId: ORDER_ID,
        questionnaireKey: "compliance",
        status: "submitted",
        createdAt: "2026-09-10T07:30:00Z",
        submittedAt: "2026-09-12T10:20:00Z",
      },
    ]);
    expect(states.get(OTHER_ORDER_ID)).toHaveLength(1);
    expect(argsOf(calls, "assessments", "order")).toEqual([["created_at", { ascending: true }]]);
  });

  it("filters the ids to unique uuids before the read and reads nothing when none is left", async () => {
    const some = stubClient({ assessments: { data: [], error: null } });
    await listAssessmentStates(some.supabase, [ORDER_ID, "nope", ORDER_ID]);
    expect(argsOf(some.calls, "assessments", "in")).toEqual([["order_id", [ORDER_ID]]]);

    const none = stubClient({});
    expect(await listAssessmentStates(none.supabase, ["nope", ""])).toEqual(new Map());
    expect(none.calls).toEqual([]);
  });

  it("reads the assessments table alone and never a rating, a note or an answer", async () => {
    const { supabase, calls } = stubClient({ assessments: { data: [], error: null } });
    await listAssessmentStates(supabase, [ORDER_ID]);
    expect(tablesRead(calls)).toEqual(["assessments"]);
    const [columns] = argsOf(calls, "assessments", "select")[0] as [string];
    expect(columns).toBe("order_id, questionnaire_key, status, created_at, submitted_at");
    expect(columns).not.toMatch(/rating|note|score/);
  });

  it("throws on a database error", async () => {
    const { supabase } = stubClient({
      assessments: { data: null, error: { code: "42501", message: "permission denied" } },
    });
    await expect(listAssessmentStates(supabase, [ORDER_ID])).rejects.toThrow();
  });
});
