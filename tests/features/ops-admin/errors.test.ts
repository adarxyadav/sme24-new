// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyScheduleError } from "@/features/ops-admin/errors";

/**
 * The trigger error to typed error mapping (spec 0014). Every guard in `41_orders.sql` and the
 * assignment guard in `12_expert_assignments.sql` raise `check_violation`, so the message is the
 * only thing separating a refusal ops can act on from a fault that belongs in Sentry.
 *
 * The messages here are copied from the `raise exception` lines of those two schema files rather
 * than invented, so a reworded guard fails this test instead of silently degrading every refusal
 * to `unexpected` in the UI.
 */
const CHECK_VIOLATION = "23514";

/** A PostgREST error as `@supabase/supabase-js` surfaces one from a raising trigger. */
const postgrest = (message: string, code = CHECK_VIOLATION) => ({
  code,
  message,
  details: null,
  hint: null,
});

describe("classifyScheduleError", () => {
  it("reads a deactivated expert off the assignment insert (AC-4)", () => {
    expect(classifyScheduleError(postgrest("expert_not_active: 0e00...0002 is inactive"))).toBe(
      "expert_not_assignable",
    );
  });

  it("reads the future date guard off the paid -> scheduled edge (AC-5)", () => {
    expect(classifyScheduleError(postgrest("orders scheduled_at must be in the future"))).toBe(
      "date_not_future",
    );
  });

  it("reads a lost race off the status guard, so one of two ops is told rather than overwritten", () => {
    expect(classifyScheduleError(postgrest("orders status is already scheduled"))).toBe(
      "invalid_transition",
    );
  });

  it("reads any other refused edge as invalid_transition", () => {
    expect(classifyScheduleError(postgrest("invalid orders transition paid -> delivered"))).toBe(
      "invalid_transition",
    );
    expect(
      classifyScheduleError(postgrest("invalid orders transition delivered -> scheduled")),
    ).toBe("invalid_transition");
  });

  it("reads the expert order refusal off every delivery edge (spec 0018, AC-10)", () => {
    expect(
      classifyScheduleError(postgrest("orders delivery is not available for an expert order")),
    ).toBe("not_deliverable");
  });

  it("matches on details as well as message, since PostgREST splits a raise across both", () => {
    expect(
      classifyScheduleError({
        code: CHECK_VIOLATION,
        message: "new row violates a check",
        details: "expert_not_active: 0e00...0002 is invited",
        hint: null,
      }),
    ).toBe("expert_not_assignable");
  });

  it("calls a delivery column guard unexpected: it means the action wrote an inconsistent row", () => {
    expect(
      classifyScheduleError(
        postgrest(
          "orders delivery columns require a scheduled, in_progress or delivered order, not paid",
        ),
      ),
    ).toBe("unexpected");
    expect(
      classifyScheduleError(
        postgrest("orders scheduled requires scheduled_at and assigned_expert_id"),
      ),
    ).toBe("unexpected");
  });

  it("calls anything that is not a check violation unexpected, whatever it says", () => {
    // A unique violation carries the assignment message but is not a guard; the caller handles
    // 23505 itself, and everything else here is a real fault that belongs in Sentry.
    expect(classifyScheduleError(postgrest("expert_not_active: x", "23505"))).toBe("unexpected");
    expect(classifyScheduleError(postgrest("permission denied for table orders", "42501"))).toBe(
      "unexpected",
    );
  });

  it("survives an error that is not a PostgREST shape at all", () => {
    expect(classifyScheduleError(null)).toBe("unexpected");
    expect(classifyScheduleError(undefined)).toBe("unexpected");
    expect(classifyScheduleError(new Error("boom"))).toBe("unexpected");
    expect(classifyScheduleError("boom")).toBe("unexpected");
    expect(classifyScheduleError({ code: CHECK_VIOLATION })).toBe("unexpected");
  });
});
