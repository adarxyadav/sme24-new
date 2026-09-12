/**
 * The database refusals the assessment actions map to a typed result (spec 0019, AC-4). Pure, so
 * a Vitest test can assert the mapping against the exact shapes the local stack produces, and so
 * an action never guesses at a message it did not raise itself.
 */

/** Postgres: check constraint violation, the errcode both assessment triggers raise with. */
const CHECK_VIOLATION = "23514";
/** Postgres: unique violation, here the one draft per company and questionnaire index. */
const UNIQUE_VIOLATION = "23505";
/** Postgres: foreign key violation, here the composite key onto `questionnaire_versions`. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Postgres: insufficient privilege, what an insert refused by a row level security policy reports. */
const INSUFFICIENT_PRIVILEGE = "42501";

/** Where the refused statement ran: the draft insert reads a policy refusal differently from the rest. */
export type AssessmentWriteContext = "start" | "write";

export type AssessmentDatabaseError =
  /** `assessment_incomplete: N items unrated` from the transition trigger (AC-4). */
  | { readonly code: "incomplete"; readonly unrated: number }
  | {
      readonly code: /** Any status change but `draft -> submitted`, including a second submit. */
        | "invalid_transition"
        /** The lock on the answers of a submitted assessment (AC-4). */
        | "locked"
        /** A second draft for the same company and questionnaire (AC-5). */
        | "draft_exists"
        /** The insert policy refused: the caller is not actively assigned, or the row is not theirs. */
        | "not_assigned"
        /** RLS hid the row from a write, so it is a 404 to this caller, never a 403. */
        | "not_found"
        /** No version row matches the questionnaire, or the item does not exist. */
        | "unknown_questionnaire"
        /** An answer named an item that does not exist. */
        | "invalid"
        | "unexpected";
    };

type PostgrestLike = {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
};

const UNRATED_PATTERN = /assessment_incomplete: (\d+) items? unrated/;

/**
 * Classifies a refused assessment write. The two triggers raise `check_violation`, so their
 * fragments separate them: `assessment_incomplete: N items unrated` (the count is parsed),
 * `invalid assessments transition` and `assessment_locked: <id>`. The three Postgres codes cover
 * the rest: `23505` is the partial unique index refusing a second draft; `42501` is a policy
 * refusal, which on the draft insert means the caller is not assigned and anywhere else means the
 * row is not theirs (a foreign or unknown id is `not_found`, never a 403); `23503` is the
 * composite foreign key refusing a questionnaire on the insert, or an unknown item on an answer.
 * Anything else is a real fault and reaches Sentry as `unexpected`. Pure.
 */
export function classifyAssessmentError(
  error: unknown,
  context: AssessmentWriteContext = "write",
): AssessmentDatabaseError {
  const postgrest = (error ?? {}) as PostgrestLike;
  const message = `${postgrest.message ?? ""} ${postgrest.details ?? ""}`;

  if (postgrest.code === CHECK_VIOLATION) {
    const unrated = UNRATED_PATTERN.exec(message);
    if (unrated) return { code: "incomplete", unrated: Number(unrated[1]) };
    if (message.includes("assessment_locked")) return { code: "locked" };
    if (message.includes("invalid assessments transition")) return { code: "invalid_transition" };
    return { code: "unexpected" };
  }
  if (postgrest.code === UNIQUE_VIOLATION) return { code: "draft_exists" };
  if (postgrest.code === INSUFFICIENT_PRIVILEGE) {
    return { code: context === "start" ? "not_assigned" : "not_found" };
  }
  if (postgrest.code === FOREIGN_KEY_VIOLATION) {
    return { code: context === "start" ? "unknown_questionnaire" : "invalid" };
  }
  return { code: "unexpected" };
}
