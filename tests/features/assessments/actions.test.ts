// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The assessment actions (spec 0019, AC-5, AC-6, AC-9, AC-12) over a recorded Supabase boundary.
 * What these guard is the part the database cannot: the expert check on every action, the values
 * `startAssessment` derives (the newest version, the matching booking, the Swiss calendar date,
 * the caller as expert), the read then write shape of `saveAnswer` with its two lock answers, the
 * per section recount on `assessment_incomplete`, and the event and alert firing after the write
 * and never before it.
 */
type Op = [name: string, args: unknown[]];
type Call = { table: string; ops: Op[] };
type Answer = { data: unknown; error: null | { code?: string; message: string; details?: string } };

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  calls: [] as Call[],
  answer: (() => ({ data: null, error: null })) as (call: Call) => Answer,
  sendOpsAlert: vi.fn(),
  captureServerEvent: vi.fn(),
  captureException: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

function chainFor(call: Call): Record<string | symbol, unknown> {
  const chain: Record<string | symbol, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (resolve: (value: Answer) => void) => resolve(boundary.answer(call));
        }
        return (...args: unknown[]) => {
          call.ops.push([String(prop), args]);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: (table: string) => {
      const call: Call = { table, ops: [] };
      boundary.calls.push(call);
      return chainFor(call);
    },
  }),
}));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.sendOpsAlert }));
vi.mock("@/lib/analytics/server", () => ({ captureServerEvent: boundary.captureServerEvent }));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: boundary.logWarn, error: boundary.logError, debug: vi.fn() },
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "de-CH" }));

const {
  saveAnswer,
  setSectionExclusion,
  startAssessment,
  submitAssessment,
  updateAssessmentDetails,
} = await import("@/features/assessments/actions");

const EXPERT_ID = "0e000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000002";
const COMPANY_ID = "0e000000-0000-4000-8000-000000000003";
const ORDER_ID = "0e000000-0000-4000-8000-000000000004";
const ASSESSMENT_ID = "0e000000-0000-4000-8000-000000000005";

const expertClaims = { sub: EXPERT_ID, app_metadata: { role: "expert" } };
const clientClaims = { sub: EXPERT_ID, app_metadata: { role: "client", organization_id: ORG_ID } };

const text = (en: string) => ({ de: `${en} (de)`, en });

const VERSION = {
  key: "iso45001@1",
  questionnaire_key: "iso45001",
  version: 1,
  title: text("ISO 45001 Gap Assessment"),
  sections: [
    { key: "c4", label: "4", title: text("Context"), groups: [] },
    { key: "c5", label: "5", title: text("Leadership"), groups: [] },
  ],
  item_count: 3,
  source_note: null,
  created_at: "2026-09-12T00:00:00Z",
  updated_at: "2026-09-12T00:00:00Z",
};

const itemRow = (
  position: number,
  label: string,
  section: string,
  parent: number | null = null,
) => ({
  id: `iso45001@1/${position}`,
  version_key: "iso45001@1",
  position,
  parent_id: parent === null ? null : `iso45001@1/${parent}`,
  section_key: section,
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
const ITEMS = [itemRow(1, "4.1", "c4"), itemRow(2, "4.2", "c4"), itemRow(3, "5.1", "c5")];

const assessmentRow = (status: "draft" | "submitted") => ({
  id: ASSESSMENT_ID,
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
  created_at: "2026-09-12T09:00:00Z",
  updated_at: "2026-09-12T09:00:00Z",
  companies: { name: "Musterfirma AG" },
  organizations: { name: "Musterfirma AG" },
});

/** The nth call on one table, oldest first, so a sequence of reads can be answered in order. */
function nth(call: Call): number {
  return boundary.calls.filter((other) => other.table === call.table).indexOf(call);
}

function callsOn(table: string): Call[] {
  return boundary.calls.filter((call) => call.table === table);
}

function ops(call: Call | undefined, name: string): unknown[][] {
  return (call?.ops ?? []).filter(([op]) => op === name).map(([, args]) => args);
}

beforeEach(() => {
  boundary.claims = expertClaims;
  boundary.calls = [];
  boundary.answer = () => ({ data: null, error: null });
  boundary.sendOpsAlert.mockReset();
  boundary.captureServerEvent.mockReset();
  boundary.captureException.mockReset();
  boundary.logError.mockReset();
  boundary.logWarn.mockReset();
});

describe("startAssessment (AC-5, AC-12)", () => {
  const input = { organizationId: ORG_ID, companyId: COMPANY_ID, questionnaireKey: "iso45001" };

  /** A happy boundary: the company matches, one version, one booking, the insert lands. */
  function happy(bookings: unknown[] = []) {
    boundary.answer = (call) => {
      if (call.table === "companies") {
        return { data: { id: COMPANY_ID, organization_id: ORG_ID }, error: null };
      }
      if (call.table === "questionnaire_versions") return { data: VERSION, error: null };
      if (call.table === "questionnaire_items") return { data: ITEMS, error: null };
      if (call.table === "expert_bookings") return { data: bookings, error: null };
      if (call.table === "assessments") return { data: { id: ASSESSMENT_ID }, error: null };
      return { data: null, error: null };
    };
  }

  const booking = (overrides: Record<string, unknown> = {}) => ({
    id: ORDER_ID,
    organization_id: ORG_ID,
    company_id: COMPANY_ID,
    reference: "SME24-2026-0001",
    package_key: "sms",
    package_name_snapshot: "Safety Management System",
    status: "scheduled",
    // 23:30 UTC on 2 July is 01:30 on 3 July in Zurich.
    scheduled_at: "2026-07-02T23:30:00Z",
    delivered_at: null,
    ...overrides,
  });

  it("refuses a caller who is not an expert before reading anything", async () => {
    boundary.claims = clientClaims;
    expect(await startAssessment(null, input)).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.calls).toEqual([]);
  });

  it("refuses a malformed input", async () => {
    expect(await startAssessment(null, { ...input, questionnaireKey: "culture" })).toEqual({
      ok: false,
      error: "validation",
    });
  });

  it("answers company_mismatch when the company belongs to another organization", async () => {
    boundary.answer = (call) =>
      call.table === "companies"
        ? {
            data: { id: COMPANY_ID, organization_id: "0e000000-0000-4000-8000-000000000099" },
            error: null,
          }
        : { data: null, error: null };
    expect(await startAssessment(null, input)).toEqual({ ok: false, error: "company_mismatch" });
    expect(callsOn("assessments")).toEqual([]);
  });

  it("answers unknown_questionnaire when no version is seeded", async () => {
    boundary.answer = (call) =>
      call.table === "companies"
        ? { data: { id: COMPANY_ID, organization_id: ORG_ID }, error: null }
        : { data: call.table === "expert_bookings" ? [] : null, error: null };
    expect(await startAssessment(null, input)).toEqual({
      ok: false,
      error: "unknown_questionnaire",
    });
    expect(callsOn("assessments")).toEqual([]);
  });

  it("inserts the newest version, the matching booking and its Swiss date with the caller as expert", async () => {
    happy([booking()]);
    const result = await startAssessment(null, input);
    expect(result).toEqual({ ok: true, data: { assessmentId: ASSESSMENT_ID } });

    const versions = callsOn("questionnaire_versions")[0];
    expect(ops(versions, "order")).toEqual([["version", { ascending: false }]]);
    expect(ops(versions, "limit")).toEqual([[1]]);

    const insert = ops(callsOn("assessments")[0], "insert")[0]?.[0];
    expect(insert).toEqual({
      organization_id: ORG_ID,
      company_id: COMPANY_ID,
      order_id: ORDER_ID,
      questionnaire_key: "iso45001",
      questionnaire_version_key: "iso45001@1",
      expert_id: EXPERT_ID,
      conducted_on: "2026-07-03",
    });
    expect(boundary.captureServerEvent).toHaveBeenCalledWith({
      distinctId: EXPERT_ID,
      event: "assessment.started",
      properties: {
        organizationId: ORG_ID,
        locale: "de",
        assessmentId: ASSESSMENT_ID,
        questionnaireKey: "iso45001",
        orderId: ORDER_ID,
      },
    });
  });

  it("links no order when no open booking's package runs this questionnaire", async () => {
    happy([
      booking({ package_key: "culture" }),
      booking({ id: "0e000000-0000-4000-8000-000000000044", status: "delivered" }),
      booking({
        id: "0e000000-0000-4000-8000-000000000045",
        company_id: "0e000000-0000-4000-8000-000000000046",
      }),
    ]);
    await startAssessment(null, input);
    const insert = ops(callsOn("assessments")[0], "insert")[0]?.[0] as Record<string, unknown>;
    expect(insert.order_id).toBeNull();
    expect(insert.conducted_on).toBeNull();
    expect(boundary.captureServerEvent.mock.calls[0]?.[0].properties.orderId).toBeNull();
  });

  it("takes an in_progress booking of the compliance package for the ISO questionnaire", async () => {
    happy([booking({ package_key: "compliance", status: "in_progress" })]);
    await startAssessment(null, input);
    const insert = ops(callsOn("assessments")[0], "insert")[0]?.[0] as Record<string, unknown>;
    expect(insert.order_id).toBe(ORDER_ID);
  });

  it("maps the two refusals of the insert and fires no event", async () => {
    for (const [code, error] of [
      ["23505", "draft_exists"],
      ["42501", "not_assigned"],
    ] as const) {
      boundary.calls = [];
      boundary.captureServerEvent.mockReset();
      happy();
      const inner = boundary.answer;
      boundary.answer = (call) =>
        call.table === "assessments" ? { data: null, error: { code, message: code } } : inner(call);
      expect(await startAssessment(null, input)).toEqual({ ok: false, error });
      expect(boundary.captureServerEvent).not.toHaveBeenCalled();
    }
  });

  it("reports an unknown failure as unexpected and to Sentry", async () => {
    happy();
    const inner = boundary.answer;
    boundary.answer = (call) =>
      call.table === "assessments"
        ? { data: null, error: { code: "08006", message: "connection lost" } }
        : inner(call);
    expect(await startAssessment(null, input)).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("updateAssessmentDetails (AC-6)", () => {
  const input = { assessmentId: ASSESSMENT_ID, site: " Werk Nord ", conductedOn: "2026-10-03" };

  it("answers not_found when RLS hides the row", async () => {
    expect(await updateAssessmentDetails(null, input)).toEqual({ ok: false, error: "not_found" });
  });

  it("answers locked on a submitted assessment without writing", async () => {
    boundary.answer = () => ({
      data: { organization_id: ORG_ID, status: "submitted" },
      error: null,
    });
    expect(await updateAssessmentDetails(null, input)).toEqual({ ok: false, error: "locked" });
    expect(callsOn("assessments")).toHaveLength(1);
  });

  it("writes only site and conducted_on, guarded on the draft status", async () => {
    boundary.answer = (call) =>
      nth(call) === 0
        ? { data: { organization_id: ORG_ID, status: "draft" }, error: null }
        : { data: { id: ASSESSMENT_ID }, error: null };
    expect(await updateAssessmentDetails(null, input)).toEqual({
      ok: true,
      data: { assessmentId: ASSESSMENT_ID },
    });
    const write = callsOn("assessments")[1];
    expect(ops(write, "update")).toEqual([[{ site: "Werk Nord", conducted_on: "2026-10-03" }]]);
    expect(ops(write, "eq")).toEqual([
      ["id", ASSESSMENT_ID],
      ["status", "draft"],
    ]);
  });
});

describe("saveAnswer (AC-6)", () => {
  const input = {
    assessmentId: ASSESSMENT_ID,
    itemId: "iso45001@1/1",
    rating: "partial",
    note: "Seen",
  };
  const draft = {
    organization_id: ORG_ID,
    status: "draft",
    questionnaire_version_key: "iso45001@1",
  };
  const item = { id: "iso45001@1/1", version_key: "iso45001@1", rateable: true };

  it("answers not_found for a hidden assessment and locked for a submitted one", async () => {
    expect(await saveAnswer(null, input)).toEqual({ ok: false, error: "not_found" });
    boundary.answer = () => ({ data: { ...draft, status: "submitted" }, error: null });
    expect(await saveAnswer(null, input)).toEqual({ ok: false, error: "locked" });
    expect(callsOn("assessment_answers")).toEqual([]);
  });

  it("answers invalid for an item of another version or a context line", async () => {
    boundary.answer = (call) =>
      call.table === "assessments"
        ? { data: draft, error: null }
        : { data: { ...item, version_key: "iso45001@2" }, error: null };
    expect(await saveAnswer(null, input)).toEqual({ ok: false, error: "invalid" });
    boundary.answer = (call) =>
      call.table === "assessments"
        ? { data: draft, error: null }
        : { data: { ...item, rateable: false }, error: null };
    expect(await saveAnswer(null, input)).toEqual({ ok: false, error: "invalid" });
    expect(callsOn("assessment_answers")).toEqual([]);
  });

  it("inserts a new answer row for the assessment's organization", async () => {
    boundary.answer = (call) => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_items") return { data: item, error: null };
      return nth(call) === 0
        ? { data: null, error: null }
        : { data: { updated_at: "2026-09-12T10:00:00Z" }, error: null };
    };
    expect(await saveAnswer(null, input)).toEqual({
      ok: true,
      data: { savedAt: "2026-09-12T10:00:00Z" },
    });
    const insert = callsOn("assessment_answers")[1];
    expect(ops(insert, "insert")).toEqual([
      [
        {
          organization_id: ORG_ID,
          assessment_id: ASSESSMENT_ID,
          item_id: "iso45001@1/1",
          rating: "partial",
          note: "Seen",
        },
      ],
    ]);
  });

  it("updates the existing row by its keys", async () => {
    boundary.answer = (call) => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_items") return { data: item, error: null };
      return nth(call) === 0
        ? { data: { id: "row" }, error: null }
        : { data: { updated_at: "2026-09-12T10:01:00Z" }, error: null };
    };
    expect(await saveAnswer(null, { ...input, rating: null, note: "" })).toEqual({
      ok: true,
      data: { savedAt: "2026-09-12T10:01:00Z" },
    });
    const update = callsOn("assessment_answers")[1];
    expect(ops(update, "update")).toEqual([[{ rating: null, note: null }]]);
    expect(ops(update, "eq")).toEqual([
      ["assessment_id", ASSESSMENT_ID],
      ["item_id", "iso45001@1/1"],
    ]);
  });

  it("reads a late insert refused by the lock trigger as locked", async () => {
    boundary.answer = (call) => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_items") return { data: item, error: null };
      return nth(call) === 0
        ? { data: null, error: null }
        : { data: null, error: { code: "23514", message: `assessment_locked: ${ASSESSMENT_ID}` } };
    };
    expect(await saveAnswer(null, input)).toEqual({ ok: false, error: "locked" });
  });

  it("reads a late update filtered to zero rows as locked", async () => {
    boundary.answer = (call) => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_items") return { data: item, error: null };
      return nth(call) === 0 ? { data: { id: "row" }, error: null } : { data: null, error: null };
    };
    expect(await saveAnswer(null, input)).toEqual({ ok: false, error: "locked" });
  });

  it("falls through to the update when a concurrent insert won the race", async () => {
    boundary.answer = (call) => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_items") return { data: item, error: null };
      if (nth(call) === 0) return { data: null, error: null };
      if (nth(call) === 1) return { data: null, error: { code: "23505", message: "duplicate" } };
      return { data: { updated_at: "2026-09-12T10:02:00Z" }, error: null };
    };
    expect(await saveAnswer(null, input)).toEqual({
      ok: true,
      data: { savedAt: "2026-09-12T10:02:00Z" },
    });
    expect(callsOn("assessment_answers")).toHaveLength(3);
  });
});

describe("setSectionExclusion (AC-8)", () => {
  const input = {
    assessmentId: ASSESSMENT_ID,
    sectionKey: "hot_work",
    excluded: true,
    note: "No hot work on this site",
  };
  const draft = {
    organization_id: ORG_ID,
    status: "draft",
    questionnaire_key: "compliance",
    questionnaire_version_key: "compliance@1",
  };
  const outline = {
    sections: [
      { key: "electrical_safety", label: "1", title: text("Electrical safety"), groups: [] },
      { key: "hot_work", label: "8", title: text("Hot work"), groups: [] },
    ],
  };
  /** The draft, the outline and no existing exclusion row; the write answers `written`. */
  const answering =
    (written: Answer, existing: unknown = null) =>
    (call: Call): Answer => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_versions") return { data: outline, error: null };
      return nth(call) === 0 ? { data: existing, error: null } : written;
    };

  it("refuses a caller who is not an expert before reading anything", async () => {
    boundary.claims = clientClaims;
    expect(await setSectionExclusion(null, input)).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.calls).toEqual([]);
  });

  it("answers not_found for a hidden assessment and locked for a submitted one", async () => {
    expect(await setSectionExclusion(null, input)).toEqual({ ok: false, error: "not_found" });
    boundary.answer = () => ({ data: { ...draft, status: "submitted" }, error: null });
    expect(await setSectionExclusion(null, input)).toEqual({ ok: false, error: "locked" });
    expect(callsOn("assessment_answers")).toEqual([]);
  });

  it("answers not_allowed for ISO 45001 from the row's own questionnaire key, before any write", async () => {
    boundary.answer = () => ({
      data: { ...draft, questionnaire_key: "iso45001", questionnaire_version_key: "iso45001@1" },
      error: null,
    });
    expect(await setSectionExclusion(null, { ...input, sectionKey: "c4" })).toEqual({
      ok: false,
      error: "not_allowed",
    });
    expect(callsOn("questionnaire_versions")).toEqual([]);
    expect(callsOn("assessment_answers")).toEqual([]);
  });

  it("answers invalid for a section the pinned outline does not name", async () => {
    boundary.answer = answering({ data: null, error: null });
    expect(await setSectionExclusion(null, { ...input, sectionKey: "excavation" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(callsOn("assessment_answers")).toEqual([]);
  });

  it("inserts the exclusion row with no item and the note for the assessment's organization", async () => {
    boundary.answer = answering({ data: { id: "row" }, error: null });
    expect(await setSectionExclusion(null, input)).toEqual({
      ok: true,
      data: { sectionKey: "hot_work", excluded: true },
    });
    const read = callsOn("assessment_answers")[0];
    expect(ops(read, "is")).toEqual([["item_id", null]]);
    const insert = callsOn("assessment_answers")[1];
    expect(ops(insert, "insert")).toEqual([
      [
        {
          organization_id: ORG_ID,
          assessment_id: ASSESSMENT_ID,
          item_id: null,
          section_key: "hot_work",
          rating: null,
          note: "No hot work on this site",
        },
      ],
    ]);
  });

  it("updates only the note when the section is already excluded", async () => {
    boundary.answer = answering({ data: { id: "row" }, error: null }, { id: "row" });
    expect(await setSectionExclusion(null, { ...input, note: "" })).toEqual({
      ok: true,
      data: { sectionKey: "hot_work", excluded: true },
    });
    const update = callsOn("assessment_answers")[1];
    expect(ops(update, "update")).toEqual([[{ note: null }]]);
    expect(ops(update, "eq")).toEqual([
      ["assessment_id", ASSESSMENT_ID],
      ["section_key", "hot_work"],
    ]);
    expect(ops(update, "is")).toEqual([["item_id", null]]);
    expect(callsOn("assessment_answers")).toHaveLength(2);
  });

  it("deletes the row by its id when the section is included again", async () => {
    boundary.answer = answering({ data: { id: "row" }, error: null }, { id: "row" });
    expect(await setSectionExclusion(null, { ...input, excluded: false, note: null })).toEqual({
      ok: true,
      data: { sectionKey: "hot_work", excluded: false },
    });
    const remove = callsOn("assessment_answers")[1];
    expect(ops(remove, "delete")).toEqual([[]]);
    expect(ops(remove, "eq")).toEqual([["id", "row"]]);
  });

  it("answers ok without a write when including a section that is not excluded", async () => {
    boundary.answer = answering({ data: null, error: null });
    expect(await setSectionExclusion(null, { ...input, excluded: false })).toEqual({
      ok: true,
      data: { sectionKey: "hot_work", excluded: false },
    });
    expect(callsOn("assessment_answers")).toHaveLength(1);
  });

  it("reads a late insert refused by the lock trigger and a late delete filtered to zero rows as locked", async () => {
    boundary.answer = answering({
      data: null,
      error: { code: "23514", message: `assessment_locked: ${ASSESSMENT_ID}` },
    });
    expect(await setSectionExclusion(null, input)).toEqual({ ok: false, error: "locked" });
    boundary.calls = [];
    boundary.answer = answering({ data: null, error: null }, { id: "row" });
    expect(await setSectionExclusion(null, { ...input, excluded: false })).toEqual({
      ok: false,
      error: "locked",
    });
  });

  it("falls through to the note update when a concurrent exclusion won the race", async () => {
    boundary.answer = (call) => {
      if (call.table === "assessments") return { data: draft, error: null };
      if (call.table === "questionnaire_versions") return { data: outline, error: null };
      if (nth(call) === 0) return { data: null, error: null };
      if (nth(call) === 1) return { data: null, error: { code: "23505", message: "duplicate" } };
      return { data: { id: "row" }, error: null };
    };
    expect(await setSectionExclusion(null, input)).toEqual({
      ok: true,
      data: { sectionKey: "hot_work", excluded: true },
    });
    expect(callsOn("assessment_answers")).toHaveLength(3);
  });

  it("reports an unknown failure as unexpected and to Sentry", async () => {
    boundary.answer = answering({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await setSectionExclusion(null, input)).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
  });
});

describe("submitAssessment (AC-9, AC-12)", () => {
  const input = { assessmentId: ASSESSMENT_ID };

  /** The page reads `getAssessment` makes after the status write, answered in order. */
  function pageAnswers(status: "draft" | "submitted", answers: unknown[]) {
    return (call: Call): Answer | null => {
      if (call.table === "questionnaire_versions") return { data: VERSION, error: null };
      if (call.table === "questionnaire_items") return { data: ITEMS, error: null };
      if (call.table === "assessment_answers") return { data: answers, error: null };
      if (call.table === "profiles") return { data: { full_name: "Erika Muster" }, error: null };
      if (call.table === "assessments" && nth(call) >= 2) {
        return { data: assessmentRow(status), error: null };
      }
      return null;
    };
  }

  it("answers not_found and locked before writing", async () => {
    expect(await submitAssessment(null, input)).toEqual({ ok: false, error: "not_found" });
    boundary.answer = () => ({
      data: { organization_id: ORG_ID, status: "submitted" },
      error: null,
    });
    expect(await submitAssessment(null, input)).toEqual({ ok: false, error: "locked" });
    expect(boundary.captureServerEvent).not.toHaveBeenCalled();
  });

  it("names the unrated count per section when the trigger refuses", async () => {
    const page = pageAnswers("draft", [
      { item_id: "iso45001@1/1", section_key: null, rating: "compliant", note: null },
    ]);
    boundary.answer = (call) => {
      if (call.table === "assessments" && nth(call) === 0) {
        return { data: { organization_id: ORG_ID, status: "draft" }, error: null };
      }
      if (call.table === "assessments" && nth(call) === 1) {
        return {
          data: null,
          error: { code: "23514", message: "assessment_incomplete: 2 items unrated" },
        };
      }
      return page(call) ?? { data: null, error: null };
    };
    expect(await submitAssessment(null, input)).toEqual({
      ok: false,
      error: "incomplete",
      unrated: 2,
      sections: [
        { key: "c4", label: "4", title: text("Context"), unrated: 1 },
        { key: "c5", label: "5", title: text("Leadership"), unrated: 1 },
      ],
    });
    expect(boundary.captureServerEvent).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });

  it("locks the draft, then captures the event and sends the alert with the score", async () => {
    const page = pageAnswers("submitted", [
      { item_id: "iso45001@1/1", section_key: null, rating: "compliant", note: null },
      { item_id: "iso45001@1/2", section_key: null, rating: "partial", note: null },
      { item_id: "iso45001@1/3", section_key: null, rating: "non_compliant", note: null },
    ]);
    boundary.answer = (call) => {
      if (call.table === "assessments" && nth(call) === 0) {
        return { data: { organization_id: ORG_ID, status: "draft" }, error: null };
      }
      if (call.table === "assessments" && nth(call) === 1) {
        return { data: { submitted_at: "2026-09-12T10:00:00Z" }, error: null };
      }
      return page(call) ?? { data: null, error: null };
    };
    expect(await submitAssessment(null, input)).toEqual({
      ok: true,
      data: { submittedAt: "2026-09-12T10:00:00Z", score: 50 },
    });

    const write = callsOn("assessments")[1];
    expect(ops(write, "update")).toEqual([[{ status: "submitted" }]]);
    expect(ops(write, "eq")).toEqual([
      ["id", ASSESSMENT_ID],
      ["status", "draft"],
    ]);
    expect(boundary.captureServerEvent).toHaveBeenCalledWith({
      distinctId: EXPERT_ID,
      event: "assessment.submitted",
      properties: {
        organizationId: ORG_ID,
        locale: "de",
        assessmentId: ASSESSMENT_ID,
        questionnaireKey: "iso45001",
        orderId: ORDER_ID,
      },
    });
    expect(boundary.sendOpsAlert).toHaveBeenCalledWith({
      kind: "assessment.submitted",
      fields: {
        companyName: "Musterfirma AG",
        questionnaireTitle: "ISO 45001 Gap Assessment",
        expertName: "Erika Muster",
        scorePercent: 50,
      },
      link: "/admin/orders",
      idempotencyKey: `assessment/submitted/${ASSESSMENT_ID}`,
    });
  });

  it("still answers ok when the alert throws, because the write has landed", async () => {
    const page = pageAnswers("submitted", [
      { item_id: "iso45001@1/1", section_key: null, rating: "compliant", note: null },
    ]);
    boundary.answer = (call) => {
      if (call.table === "assessments" && nth(call) === 0) {
        return { data: { organization_id: ORG_ID, status: "draft" }, error: null };
      }
      if (call.table === "assessments" && nth(call) === 1) {
        return { data: { submitted_at: "2026-09-12T10:00:00Z" }, error: null };
      }
      return page(call) ?? { data: null, error: null };
    };
    boundary.sendOpsAlert.mockRejectedValueOnce(new Error("slack down"));
    expect(await submitAssessment(null, input)).toEqual({
      ok: true,
      data: { submittedAt: "2026-09-12T10:00:00Z", score: 100 },
    });
    expect(boundary.logWarn).toHaveBeenCalledTimes(1);
  });
});
