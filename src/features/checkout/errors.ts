/**
 * The database errors the checkout actions map to a typed result (spec 0011). Pure, so a Vitest
 * test can assert the mapping against the exact error shapes the local stack produces.
 */

/** Postgres: unique violation. */
const UNIQUE_VIOLATION = "23505";
/** Postgres: check constraint violation, what the money invariant and the state machine raise. */
const CHECK_VIOLATION = "23514";
/** Postgres: insufficient privilege, what a row level security check answers. */
const RLS_VIOLATION = "42501";

/** The unique constraint that keeps one order per Stripe Checkout Session (`41_orders.sql`). */
export const SESSION_UNIQUE = "orders_stripe_checkout_session_id_key";
/** The unique constraint that keeps one invoice per order (`43_invoices.sql`). */
export const INVOICE_ORDER_UNIQUE = "invoices_order_id_key";

export type OrderInsertError = "duplicate_session" | "forbidden" | "invalid_amount" | "unexpected";

type PostgrestLike = {
  readonly code?: string | null;
  readonly message?: string | null;
  readonly details?: string | null;
  readonly hint?: string | null;
};

function asPostgrest(error: unknown): PostgrestLike {
  return (error ?? {}) as PostgrestLike;
}

/** True when the error names the given constraint, matched on the name and never the bare code. */
function namesConstraint(error: PostgrestLike, constraint: string): boolean {
  return `${error.message ?? ""} ${error.details ?? ""}`.includes(constraint);
}

/**
 * Maps the error of an order insert: a unique violation naming the session constraint means the
 * webhook already created this order; a check violation means the amounts did not satisfy
 * `gross = net + vat`, which is a bug in the caller rather than a user error; a row level security
 * violation means the caller does not belong to the organization or the company. Pure.
 */
export function classifyOrderInsertError(error: unknown): OrderInsertError {
  const postgrest = asPostgrest(error);
  if (postgrest.code === UNIQUE_VIOLATION && namesConstraint(postgrest, SESSION_UNIQUE)) {
    return "duplicate_session";
  }
  if (postgrest.code === CHECK_VIOLATION) return "invalid_amount";
  if (postgrest.code === RLS_VIOLATION) return "forbidden";
  return "unexpected";
}

/** True when the error is the one invoice per order guard, so the invoice already exists. Pure. */
export function isDuplicateInvoice(error: unknown): boolean {
  const postgrest = asPostgrest(error);
  return postgrest.code === UNIQUE_VIOLATION && namesConstraint(postgrest, INVOICE_ORDER_UNIQUE);
}

/** True when the error is the duplicate guard on the stripe event log (`44_stripe_events.sql`). Pure. */
export function isDuplicateStripeEvent(error: unknown): boolean {
  return asPostgrest(error).code === UNIQUE_VIOLATION;
}
