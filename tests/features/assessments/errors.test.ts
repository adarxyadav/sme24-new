// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyAssessmentError } from "@/features/assessments/errors";

/**
 * The refusal mapping (spec 0019, AC-4): the exact shapes the local stack produces for the two
 * triggers and the three Postgres codes, so an action never guesses at a message and a foreign id
 * is a 404 rather than a 403.
 */

const check = (message: string) => ({ code: "23514", message, details: null, hint: null });

describe("classifyAssessmentError", () => {
  it("parses the unrated count out of assessment_incomplete", () => {
    expect(classifyAssessmentError(check("assessment_incomplete: 5 items unrated"))).toEqual({
      code: "incomplete",
      unrated: 5,
    });
    expect(classifyAssessmentError(check("assessment_incomplete: 1 items unrated"))).toEqual({
      code: "incomplete",
      unrated: 1,
    });
  });

  it("reads the lock and the transition fragments", () => {
    expect(
      classifyAssessmentError(check("assessment_locked: 0e000000-0000-4000-8000-000000000001")),
    ).toEqual({ code: "locked" });
    expect(
      classifyAssessmentError(
        check(
          "invalid assessments transition submitted -> draft on 0e000000-0000-4000-8000-000000000001",
        ),
      ),
    ).toEqual({ code: "invalid_transition" });
  });

  it("reads a fragment from details when the message carries the generic text", () => {
    expect(
      classifyAssessmentError({
        code: "23514",
        message: "new row violates check constraint",
        details: "assessment_locked: x",
      }),
    ).toEqual({ code: "locked" });
  });

  it("maps a unique violation to draft_exists", () => {
    expect(
      classifyAssessmentError({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "assessments_one_draft_per_company_questionnaire_idx"',
      }),
    ).toEqual({ code: "draft_exists" });
  });

  it("maps a policy refusal to not_assigned on the start and not_found elsewhere, never a 403", () => {
    const refused = {
      code: "42501",
      message: 'new row violates row-level security policy for table "assessments"',
    };
    expect(classifyAssessmentError(refused, "start")).toEqual({ code: "not_assigned" });
    expect(classifyAssessmentError(refused, "write")).toEqual({ code: "not_found" });
    expect(classifyAssessmentError(refused)).toEqual({ code: "not_found" });
  });

  it("maps a foreign key violation to unknown_questionnaire on the start and invalid elsewhere", () => {
    const missing = {
      code: "23503",
      message: 'insert or update on table "assessments" violates foreign key constraint',
    };
    expect(classifyAssessmentError(missing, "start")).toEqual({ code: "unknown_questionnaire" });
    expect(classifyAssessmentError(missing, "write")).toEqual({ code: "invalid" });
  });

  it("answers unexpected for anything else, including an unknown check fragment", () => {
    expect(classifyAssessmentError(check("some other constraint"))).toEqual({
      code: "unexpected",
    });
    expect(classifyAssessmentError({ code: "08006", message: "connection lost" })).toEqual({
      code: "unexpected",
    });
    expect(classifyAssessmentError(null)).toEqual({ code: "unexpected" });
    expect(classifyAssessmentError(new Error("boom"))).toEqual({ code: "unexpected" });
  });
});
