/**
 * The database errors the research actions map to a result (spec 0007, AC-9). Pure, so a Vitest
 * test can assert the mapping against the exact error shapes recorded from the local stack.
 */

/** The partial unique index that allows one open run per company (`22_research_runs.sql`). */
export const OPEN_RUN_INDEX = "research_runs_one_open_per_company_idx";

/** Postgres: unique violation. */
const UNIQUE_VIOLATION = "23505";
/** Postgres: insufficient privilege, what a row level security check answers. */
const RLS_VIOLATION = "42501";

export type RunInsertError = "run_in_progress" | "quota_exceeded" | "unexpected";

type PostgrestLike = {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
};

/**
 * Maps the error of a run insert: a unique violation naming the open run index (matched on the
 * constraint name, never on the bare code, since other 23505 violations exist) gives
 * `run_in_progress`; a row level security violation gives `quota_exceeded` (the action sets the
 * organization and requester itself, so the quota is the only policy reason left); anything else
 * is `unexpected`. Pure.
 */
export function classifyRunInsertError(error: unknown): RunInsertError {
  if (!error || typeof error !== "object") return "unexpected";
  const { code, message, details } = error as PostgrestLike;
  if (code === UNIQUE_VIOLATION) {
    const text = `${message ?? ""} ${details ?? ""}`;
    return text.includes(OPEN_RUN_INDEX) ? "run_in_progress" : "unexpected";
  }
  if (code === RLS_VIOLATION) return "quota_exceeded";
  return "unexpected";
}
