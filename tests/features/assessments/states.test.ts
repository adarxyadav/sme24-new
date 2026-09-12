import { describe, expect, it } from "vitest";
import { type AssessmentState, orderAssessmentLines } from "@/features/assessments/states";

/**
 * The state lines of a booked order (spec 0019, AC-10): what the client card and the ops table
 * show per questionnaire, and nothing else. Pure over `PACKAGE_QUESTIONNAIRES` and the reduced
 * `assessments` rows.
 */

const ORDER = "d0000000-0000-4000-8000-000000000001";

const row = (
  questionnaireKey: string,
  status: AssessmentState["status"],
  createdAt: string,
  submittedAt: string | null = null,
): AssessmentState => ({ orderId: ORDER, questionnaireKey, status, createdAt, submittedAt });

describe("orderAssessmentLines", () => {
  it("lists every questionnaire the package's visit runs as not started when nothing is linked", () => {
    expect(orderAssessmentLines("compliance", [])).toEqual([
      { questionnaireKey: "compliance", state: "not_started", at: null },
      { questionnaireKey: "iso45001", state: "not_started", at: null },
    ]);
    expect(orderAssessmentLines("sms", [])).toEqual([
      { questionnaireKey: "iso45001", state: "not_started", at: null },
    ]);
  });

  it("shows one not started line for a package that runs no questionnaire", () => {
    expect(orderAssessmentLines("culture", [])).toEqual([
      { questionnaireKey: null, state: "not_started", at: null },
    ]);
    expect(orderAssessmentLines("unknown_package", [])).toEqual([
      { questionnaireKey: null, state: "not_started", at: null },
    ]);
  });

  it("reads a draft as in progress since its start and a submission as submitted on its date", () => {
    const lines = orderAssessmentLines("compliance", [
      row("compliance", "draft", "2026-09-12T08:00:00Z"),
      row("iso45001", "submitted", "2026-09-10T08:00:00Z", "2026-09-11T16:00:00Z"),
    ]);
    expect(lines).toEqual([
      { questionnaireKey: "compliance", state: "in_progress", at: "2026-09-12T08:00:00Z" },
      { questionnaireKey: "iso45001", state: "submitted", at: "2026-09-11T16:00:00Z" },
    ]);
  });

  it("lets an open draft outrank an older submission and picks the newest submission otherwise", () => {
    expect(
      orderAssessmentLines("sms", [
        row("iso45001", "submitted", "2026-09-01T08:00:00Z", "2026-09-02T08:00:00Z"),
        row("iso45001", "draft", "2026-09-05T08:00:00Z"),
      ]),
    ).toEqual([{ questionnaireKey: "iso45001", state: "in_progress", at: "2026-09-05T08:00:00Z" }]);
    expect(
      orderAssessmentLines("sms", [
        row("iso45001", "submitted", "2026-09-01T08:00:00Z", "2026-09-02T08:00:00Z"),
        row("iso45001", "submitted", "2026-09-05T08:00:00Z", "2026-09-06T08:00:00Z"),
      ]),
    ).toEqual([{ questionnaireKey: "iso45001", state: "submitted", at: "2026-09-06T08:00:00Z" }]);
  });

  it("keeps a linked questionnaire the package did not expect, after the expected ones", () => {
    expect(
      orderAssessmentLines("sms", [row("compliance", "draft", "2026-09-12T08:00:00Z")]),
    ).toEqual([
      { questionnaireKey: "iso45001", state: "not_started", at: null },
      { questionnaireKey: "compliance", state: "in_progress", at: "2026-09-12T08:00:00Z" },
    ]);
  });

  it("never carries a rating, a note or a score", () => {
    const [line] = orderAssessmentLines("sms", [row("iso45001", "draft", "2026-09-12T08:00:00Z")]);
    expect(Object.keys(line ?? {}).sort()).toEqual(["at", "questionnaireKey", "state"]);
  });
});
