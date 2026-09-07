import type { SupabaseClient } from "@supabase/supabase-js";
import { idempotencyKeys, tasks } from "@trigger.dev/sdk";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import type { confirmOrderTask } from "@/trigger/confirm-order";
import { verifyStripeEvent } from "./client";
import { orderIdFromEvent, sessionIsPaid } from "./event";

/**
 * The Stripe webhook (spec 0011, AC-5, AC-6, AC-7). This is the **only** path by which a payment
 * reaches the database: the browser return page reads the order and never writes it, so closing
 * the tab mid payment cannot lose an order.
 *
 * The route does as little as possible and returns 200 quickly, well inside Stripe's timeout:
 * verify the signature against the raw body, record the event (whose id is the primary key, so a
 * redelivery collides and is a no operation), enqueue the confirmation task, answer. All the work
 * happens in the task, where it can retry.
 *
 * Server only, unauthenticated by necessity: the Stripe signature is the authentication.
 */

type Service = SupabaseClient<Database>;

export type WebhookDeps = {
  readonly supabase?: Service;
  readonly enqueue?: (eventId: string, orderId: string, eventCreated: number) => Promise<void>;
  /** Marks an abandoned checkout expired; the sweep does the same for a session that never began. */
  readonly expire?: (orderId: string) => Promise<void>;
};

/** The events this feature acts on. Anything else is recorded and acknowledged, never rejected. */
const HANDLED = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.expired",
]);

/** How long the global idempotency key blocks a second run of the same event. */
const IDEMPOTENCY_TTL = "24h";

/** Enqueues the confirmation task under a key derived from the Stripe event id (AC-7). */
async function enqueueConfirm(
  eventId: string,
  orderId: string,
  eventCreated: number,
): Promise<void> {
  const key = await idempotencyKeys.create(`order/confirm/${eventId}`, { scope: "global" });
  await tasks.trigger<typeof confirmOrderTask>(
    "confirm-order",
    { eventId, orderId, eventCreated },
    { idempotencyKey: key, idempotencyKeyTTL: IDEMPOTENCY_TTL },
  );
}

/**
 * Moves an abandoned card order to `expired` and records the transition. Guarded on the current
 * status, so a race with a real payment changes nothing: the update simply matches no row.
 */
function expireOrder(supabase: Service) {
  return async (orderId: string): Promise<void> => {
    const { data, error } = await supabase
      .from("orders")
      .update({ status: "expired", expires_at: new Date().toISOString() })
      .eq("id", orderId)
      .eq("status", "pending")
      .select("id, organization_id")
      .maybeSingle();
    if (error) {
      log.error("stripe webhook: could not expire the order", {
        orderId,
        message: error.message,
      });
      return;
    }
    if (!data) {
      // Already paid, cancelled or expired: nothing to do, and certainly not an error.
      log.info("stripe webhook: the order was no longer pending, not expired", { orderId });
      return;
    }
    await supabase.from("order_events").insert({
      organization_id: data.organization_id,
      order_id: orderId,
      from_status: "pending",
      to_status: "expired",
      actor_role: "service",
      reason: "Stripe reported the checkout session expired",
    });
    log.info("order expired after an abandoned checkout", { orderId });
  };
}

/**
 * Handles one webhook delivery. Answers 400 on a signature that does not verify, without touching
 * the database; 200 for everything it accepts, including a duplicate, so Stripe stops retrying.
 * Server only.
 */
export async function handleStripeWebhook(
  request: Request,
  deps: WebhookDeps = {},
): Promise<Response> {
  const env = serverEnv();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // A preview without Stripe: say so plainly rather than pretending to accept the event.
    log.error("stripe webhook refused: STRIPE_WEBHOOK_SECRET is not set");
    return Response.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const rawBody = await request.text();
  const event = await verifyStripeEvent(rawBody, request.headers.get("stripe-signature"));
  if (!event) {
    log.warn("stripe webhook refused: bad signature");
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  }

  const supabase =
    deps.supabase ?? createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

  // The event id is the primary key, so a redelivery collides here and does no work twice. This
  // is the whole deduplication mechanism: no read then write check anywhere (AC-7, invariant 6).
  const { error: insertError } = await supabase.from("stripe_events").insert({
    event_id: event.id,
    type: event.type,
    payload: event as unknown as Database["public"]["Tables"]["stripe_events"]["Insert"]["payload"],
  });
  if (insertError) {
    log.info("stripe webhook: event already recorded, nothing to do", {
      eventId: event.id,
      type: event.type,
    });
    return Response.json({ received: true, duplicate: true });
  }

  if (!HANDLED.has(event.type)) {
    log.info("stripe webhook: event recorded but not acted on", {
      eventId: event.id,
      type: event.type,
    });
    return Response.json({ received: true });
  }

  const orderId = orderIdFromEvent(event);
  if (!orderId) {
    log.error("stripe webhook: no order id on the event", { eventId: event.id, type: event.type });
    // Recorded, so it can be reconciled by hand; still a 200, because retrying will not help.
    return Response.json({ received: true });
  }

  // An abandoned or timed out checkout: the order becomes `expired` and nothing else happens.
  // No invoice exists and no invoice number was consumed, because the card path issues neither
  // until payment (AC-6, invariant 11).
  if (event.type === "checkout.session.expired") {
    await (deps.expire ?? expireOrder(supabase))(orderId);
    return Response.json({ received: true });
  }

  // A completed session whose payment is still pending is not settled: the async succeeded event
  // follows when the money actually arrives.
  if (event.type === "checkout.session.completed" && !sessionIsPaid(event)) {
    log.info("stripe webhook: session completed but payment is pending", {
      eventId: event.id,
      orderId,
    });
    return Response.json({ received: true });
  }

  try {
    // event.created is Stripe's own clock, which becomes the order's paid_at.
    await (deps.enqueue ?? enqueueConfirm)(event.id, orderId, event.created);
  } catch (error) {
    // The event row is committed, so a sweep can pick it up; a 500 would make Stripe retry, which
    // would collide on the event id and never enqueue anything.
    log.error("stripe webhook: could not enqueue the confirmation", {
      eventId: event.id,
      orderId,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  return Response.json({ received: true });
}
