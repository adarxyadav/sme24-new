import type Stripe from "stripe";

/**
 * The pure reading of a Stripe event (spec 0011, AC-5, AC-7): which order it is about and whether
 * its payment has actually settled. Separate from `webhook.ts` so it carries no `server-only`
 * import and can be tested directly. Pure: no I/O, no environment.
 */

/**
 * The order this event is about. Stripe carries it in `client_reference_id`, which the checkout
 * action sets to the order id, with the metadata as a fallback. Pure.
 */
export function orderIdFromEvent(event: Stripe.Event): string | null {
  const object = event.data.object as {
    client_reference_id?: string | null;
    metadata?: Record<string, string> | null;
  };
  return object.client_reference_id ?? object.metadata?.order_id ?? null;
}

/**
 * True when a completed session actually carries money. A session can complete with a payment
 * still pending (a delayed method), and only `paid` means settled; the async succeeded event
 * follows later for those. Pure.
 */
export function sessionIsPaid(event: Stripe.Event): boolean {
  const object = event.data.object as { payment_status?: string | null };
  return object.payment_status === "paid" || object.payment_status === "no_payment_required";
}
