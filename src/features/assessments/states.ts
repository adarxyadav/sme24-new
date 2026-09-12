import { PACKAGE_QUESTIONNAIRES } from "./catalogue";

/**
 * The state of the assessments linked to a booked order (spec 0019, AC-10): what the client's
 * card on `/app` and the ops orders table show, and nothing else about an assessment. Pure, runs
 * anywhere; `listAssessmentStates` in `queries.ts` hands in the rows.
 */

/** One `assessments` row reduced to what a state line needs; never a rating, a note or a score. */
export type AssessmentState = {
  readonly orderId: string;
  readonly questionnaireKey: string;
  readonly status: "draft" | "submitted";
  readonly createdAt: string;
  readonly submittedAt: string | null;
};

export type AssessmentStateLine = {
  /** Null for the one line an order shows when its package runs no questionnaire and nothing is linked. */
  readonly questionnaireKey: string | null;
  readonly state: "not_started" | "in_progress" | "submitted";
  /** The draft's start for `in_progress`, the submission for `submitted`, null for `not_started`. */
  readonly at: string | null;
};

/**
 * One line per questionnaire an order is waiting on: the questionnaires the package's visit runs
 * (`PACKAGE_QUESTIONNAIRES`), then any other questionnaire an assessment linked to the order
 * anyway, in first seen order. A questionnaire with an open draft is in progress since that draft
 * started, else the newest submitted one is submitted on its date, else it has not started. An
 * order with nothing expected and nothing linked shows a single not started line. Pure.
 */
export function orderAssessmentLines(
  packageKey: string,
  states: readonly AssessmentState[],
): readonly AssessmentStateLine[] {
  const expected = PACKAGE_QUESTIONNAIRES[packageKey] ?? [];
  const linked = states.map((state) => state.questionnaireKey);
  const keys = [...new Set<string>([...expected, ...linked])];
  if (keys.length === 0) return [{ questionnaireKey: null, state: "not_started", at: null }];

  return keys.map((key): AssessmentStateLine => {
    const own = states.filter((state) => state.questionnaireKey === key);
    const draft = newest(own.filter((state) => state.status === "draft"));
    if (draft) return { questionnaireKey: key, state: "in_progress", at: draft.createdAt };
    const submitted = newest(own.filter((state) => state.status === "submitted"));
    if (submitted) {
      return {
        questionnaireKey: key,
        state: "submitted",
        at: submitted.submittedAt ?? submitted.createdAt,
      };
    }
    return { questionnaireKey: key, state: "not_started", at: null };
  });
}

function newest(states: readonly AssessmentState[]): AssessmentState | undefined {
  return [...states].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}
