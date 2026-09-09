import { describe, expect, it } from "vitest";
import {
  ALL_DATA_REQUEST_STATUSES,
  ANSWER_WINDOW_DAYS,
  canTransition,
  DATA_REQUEST_KINDS,
  DATA_REQUEST_RECEIVED_EVENT,
  DATA_REQUEST_STATUSES,
  DATA_REQUEST_TRANSITIONS,
  type DataRequestStatus,
  dataRequestFiltersSchema,
  dataRequestListQuery,
  dueAtFrom,
  isOpen,
  OPEN_STATUSES,
  PAGE_SIZE,
  refusalNoteMissing,
  requestDataSchema,
  updateDataRequestSchema,
} from "@/features/legal/schema";

/**
 * The data request boundary schemas and the workflow rules (spec 0015, AC-11, AC-14).
 *
 * There is no database trigger for this workflow, unlike orders in spec 0014, so the adjacency
 * list in `schema.ts` is the only thing standing between ops and an illegal move. That makes these
 * tests the guard the database would otherwise be: every edge the list allows, every edge it must
 * refuse, and the two rules layered on top of it (a refusal needs a reason, a terminal request has
 * no way back).
 */

const EVERY_STATUS = DATA_REQUEST_STATUSES;

describe("data request constants", () => {
  it("names the two rights a subject can exercise (AC-11)", () => {
    expect(DATA_REQUEST_KINDS).toEqual(["export", "deletion"]);
  });

  it("names the four statuses in workflow order", () => {
    expect(DATA_REQUEST_STATUSES).toEqual(["new", "in_progress", "fulfilled", "refused"]);
  });

  it("answers within the Art. 25 window of thirty days", () => {
    expect(ANSWER_WINDOW_DAYS).toBe(30);
  });

  it("names the alert kind the ops channel presenter is registered under (AC-13)", () => {
    expect(DATA_REQUEST_RECEIVED_EVENT).toBe("data_request.received");
  });
});

/**
 * The open set has to be exactly the two statuses the partial unique index names, or the app's
 * idea of "you already have one of these open" and the database's diverge: a status the app calls
 * open but the index does not would let a second row through and surprise the caller with a
 * success where they expected the `already_open` sentence.
 */
describe("isOpen (AC-11)", () => {
  it("counts new and in_progress as open, the two the partial unique index names", () => {
    expect(OPEN_STATUSES).toEqual(["new", "in_progress"]);
    expect(isOpen("new")).toBe(true);
    expect(isOpen("in_progress")).toBe(true);
  });

  it("counts both terminal statuses as closed, so a new request of the same kind is allowed", () => {
    expect(isOpen("fulfilled")).toBe(false);
    expect(isOpen("refused")).toBe(false);
  });
});

describe("canTransition (AC-14)", () => {
  it("allows exactly the moves out of new", () => {
    expect(canTransition("new", "in_progress")).toBe(true);
    expect(canTransition("new", "refused")).toBe(true);
    // No `new -> fulfilled` shortcut: a fulfilment is work someone did, so it passes through
    // in_progress and the fulfilling ops user is on the record as the handler.
    expect(canTransition("new", "fulfilled")).toBe(false);
  });

  it("allows exactly the moves out of in_progress", () => {
    expect(canTransition("in_progress", "fulfilled")).toBe(true);
    expect(canTransition("in_progress", "refused")).toBe(true);
    expect(canTransition("in_progress", "new")).toBe(false);
  });

  it("lets nothing out of either terminal status, so a closed request is never reopened", () => {
    for (const terminal of ["fulfilled", "refused"] as const) {
      expect(DATA_REQUEST_TRANSITIONS[terminal]).toEqual([]);
      for (const to of EVERY_STATUS) {
        expect(canTransition(terminal, to), `${terminal} -> ${to}`).toBe(false);
      }
    }
  });

  it("refuses every move onto a status itself, so 'save the note only' is not a transition", () => {
    // The form offers the current status as a select option, but that path saves the note without
    // moving; the action must not treat it as an allowed edge.
    for (const status of EVERY_STATUS) {
      expect(canTransition(status, status), `${status} -> ${status}`).toBe(false);
    }
  });

  it("allows no edge the adjacency list does not list, checked over the whole matrix", () => {
    for (const from of EVERY_STATUS) {
      const allowed: readonly DataRequestStatus[] = DATA_REQUEST_TRANSITIONS[from];
      for (const to of EVERY_STATUS) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed.includes(to));
      }
    }
  });

  it("keeps every listed target a real status, so no edge points at a typo", () => {
    for (const targets of Object.values(DATA_REQUEST_TRANSITIONS)) {
      for (const target of targets) expect(EVERY_STATUS).toContain(target);
    }
  });

  it("keeps both terminal statuses reachable, so no request can be stranded open forever", () => {
    const reachable = new Set(Object.values(DATA_REQUEST_TRANSITIONS).flat());
    expect(reachable).toContain("fulfilled");
    expect(reachable).toContain("refused");
  });
});

/**
 * A refusal without a reason is the failure mode this rule exists for: the row would be a record
 * that someone said no, with nothing saying why, which is exactly the thing a supervisory
 * authority would ask about.
 */
describe("refusalNoteMissing (AC-14)", () => {
  it("refuses a refusal with no note at all", () => {
    expect(refusalNoteMissing("refused", null)).toBe(true);
  });

  it("refuses a refusal whose note is empty, the shape the schema stores a blank field as", () => {
    expect(refusalNoteMissing("refused", "")).toBe(true);
  });

  it("accepts a refusal that carries a reason", () => {
    expect(refusalNoteMissing("refused", "Identity could not be confirmed.")).toBe(false);
  });

  it("asks nothing of the other three statuses, with or without a note", () => {
    for (const status of ["new", "in_progress", "fulfilled"] as const) {
      expect(refusalNoteMissing(status, null)).toBe(false);
      expect(refusalNoteMissing(status, "a note")).toBe(false);
    }
  });
});

describe("requestDataSchema (AC-11)", () => {
  it("accepts either right", () => {
    for (const kind of DATA_REQUEST_KINDS) {
      expect(requestDataSchema.safeParse({ kind }).success).toBe(true);
    }
  });

  it("refuses a kind the app does not offer", () => {
    for (const kind of ["", "erase", "EXPORT", null, 1]) {
      expect(requestDataSchema.safeParse({ kind }).success, String(kind)).toBe(false);
    }
  });

  it("carries no requester field, so the id can only come from the caller's own claims", () => {
    const parsed = requestDataSchema.parse({
      kind: "export",
      requested_by: "22222222-2222-4222-8222-222222222222",
    });
    expect(parsed).not.toHaveProperty("requested_by");
  });
});

describe("updateDataRequestSchema (AC-14)", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("accepts a move with a note", () => {
    const parsed = updateDataRequestSchema.parse({ id, status: "refused", opsNote: "No match." });
    expect(parsed).toMatchObject({ id, status: "refused", opsNote: "No match." });
  });

  it("refuses an id that is not a UUID, so no other column shape reaches the filter", () => {
    expect(updateDataRequestSchema.safeParse({ id: "not-a-uuid", status: "refused" }).success).toBe(
      false,
    );
  });

  it("refuses a status outside the four", () => {
    expect(updateDataRequestSchema.safeParse({ id, status: "closed" }).success).toBe(false);
  });

  /**
   * The trim to null is what makes the refusal rule hold: a field holding only spaces would
   * otherwise be a truthy string, pass `refusalNoteMissing`, and store a refusal whose reason is
   * three spaces.
   */
  it("stores a note of only whitespace as null, so it cannot satisfy the refusal rule", () => {
    const parsed = updateDataRequestSchema.parse({ id, status: "refused", opsNote: "   " });
    expect(parsed.opsNote).toBeNull();
    expect(refusalNoteMissing(parsed.status, parsed.opsNote)).toBe(true);
  });

  it("stores an absent, empty or null note as null", () => {
    expect(updateDataRequestSchema.parse({ id, status: "new" }).opsNote).toBeNull();
    expect(updateDataRequestSchema.parse({ id, status: "new", opsNote: "" }).opsNote).toBeNull();
    expect(updateDataRequestSchema.parse({ id, status: "new", opsNote: null }).opsNote).toBeNull();
  });

  it("trims the surrounding whitespace off a real note", () => {
    expect(updateDataRequestSchema.parse({ id, status: "new", opsNote: "  why  " }).opsNote).toBe(
      "why",
    );
  });

  it("refuses a note past 2000 characters with the key the form translates", () => {
    const result = updateDataRequestSchema.safeParse({
      id,
      status: "new",
      opsNote: "x".repeat(2001),
    });
    expect(result.success).toBe(false);
    // The message is a catalogue key rather than prose, because `issueMessage` looks it up in
    // `adminDataRequests.form.errors`.
    expect(result.error?.issues[0]?.message).toBe("noteLong");
  });

  it("accepts a note of exactly 2000 characters", () => {
    expect(
      updateDataRequestSchema.safeParse({ id, status: "new", opsNote: "x".repeat(2000) }).success,
    ).toBe(true);
  });
});

/**
 * The list filter uses `.catch`, so a hand edited or stale query string degrades to the open queue
 * rather than throwing on a page ops opened from a bookmark.
 */
describe("dataRequestFiltersSchema (AC-13)", () => {
  it("defaults to the open queue, the filter with a deadline attached", () => {
    expect(dataRequestFiltersSchema.parse({}).status).toBe("open");
  });

  it("accepts each named status, plus open and all", () => {
    for (const status of [...DATA_REQUEST_STATUSES, ALL_DATA_REQUEST_STATUSES, "open"]) {
      expect(dataRequestFiltersSchema.parse({ status }).status).toBe(status);
    }
  });

  it("falls back to the open queue on a status it does not know", () => {
    expect(dataRequestFiltersSchema.parse({ status: "pending" }).status).toBe("open");
    expect(dataRequestFiltersSchema.parse({ status: 7 }).status).toBe("open");
  });

  it("drops an over long cursor rather than passing it to the decoder", () => {
    expect(dataRequestFiltersSchema.parse({ cursor: "x".repeat(201) }).cursor).toBeUndefined();
    expect(dataRequestFiltersSchema.parse({ cursor: "abc" }).cursor).toBe("abc");
  });

  it("pages fifty rows at a time", () => {
    expect(PAGE_SIZE).toBe(50);
  });
});

describe("dataRequestListQuery (AC-13)", () => {
  it("writes nothing for the default view, so the canonical URL carries no query", () => {
    expect(dataRequestListQuery({ status: "open" })).toBe("");
    expect(dataRequestListQuery({ status: "open" }, null)).toBe("");
  });

  it("names a status that is not the default", () => {
    expect(dataRequestListQuery({ status: "fulfilled" })).toBe("?status=fulfilled");
    expect(dataRequestListQuery({ status: "all" })).toBe("?status=all");
  });

  it("carries the cursor alone on the default view", () => {
    expect(dataRequestListQuery({ status: "open" }, "abc")).toBe("?cursor=abc");
  });

  it("carries both when a filter and a page are set", () => {
    expect(dataRequestListQuery({ status: "refused" }, "abc")).toBe("?status=refused&cursor=abc");
  });

  it("escapes a cursor so a base64url value with padding cannot break the query string", () => {
    expect(dataRequestListQuery({ status: "open" }, "a=b&c")).toBe("?cursor=a%3Db%26c");
  });
});

describe("dueAtFrom (AC-11)", () => {
  it("puts the deadline thirty days on", () => {
    const filed = new Date("2026-09-09T08:00:00.000Z");
    expect(dueAtFrom(filed).toISOString()).toBe("2026-10-09T08:00:00.000Z");
  });

  it("adds thirty whole days across the spring clock change, since the arithmetic is UTC", () => {
    // 29 March 2026 is the Swiss clock change. The window is thirty days of twenty four hours,
    // matching `purge-enquiries`, so it does not shorten by an hour here.
    const filed = new Date("2026-03-15T12:00:00.000Z");
    expect(dueAtFrom(filed).getTime() - filed.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(dueAtFrom(filed).toISOString()).toBe("2026-04-14T12:00:00.000Z");
  });

  it("does not move the date it was given", () => {
    const filed = new Date("2026-09-09T08:00:00.000Z");
    dueAtFrom(filed);
    expect(filed.toISOString()).toBe("2026-09-09T08:00:00.000Z");
  });
});
