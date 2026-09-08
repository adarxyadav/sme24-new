/**
 * The database errors the ops admin actions map to a typed result (spec 0014). Pure, so a Vitest
 * test can assert the mapping against the exact shapes the local stack produces, and so the
 * action never guesses at a message it did not raise itself.
 */

/** Postgres: check constraint violation, the errcode every guard in `41_orders.sql` raises with. */
const CHECK_VIOLATION = "23514";

/** What a scheduling write can be refused for, over and above the action's own checks. */
export type ScheduleWriteError =
  | "expert_not_assignable"
  | "date_not_future"
  | "invalid_transition"
  | "unexpected";

type PostgrestLike = {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
};

/**
 * Classifies the refusal of a delivery write. Every guard raises `check_violation`, so the message
 * is what separates them, matched on the fragment each `raise exception` writes:
 *
 * - `expert_not_active` comes from `check_expert_assignable` on the assignment insert (AC-4);
 * - `must be in the future` from the `paid -> scheduled` edge (AC-5);
 * - `orders status is already %` from two ops scheduling the same order at once, and any other
 *   `invalid orders transition` from an order that is not where the caller last read it (AC-3).
 *
 * Anything else is a real fault and reaches Sentry as `unexpected`. Pure.
 */
export function classifyScheduleError(error: unknown): ScheduleWriteError {
  const postgrest = (error ?? {}) as PostgrestLike;
  if (postgrest.code !== CHECK_VIOLATION) return "unexpected";
  const message = `${postgrest.message ?? ""} ${postgrest.details ?? ""}`;
  if (message.includes("expert_not_active")) return "expert_not_assignable";
  if (message.includes("must be in the future")) return "date_not_future";
  if (message.includes("orders status is already") || message.includes("invalid orders transition"))
    return "invalid_transition";
  // A delivery column guard raising means the write left the row inconsistent, which the action's
  // own shape should have prevented; it is a bug here rather than something ops can act on.
  return "unexpected";
}
