import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";
import { stripe } from "@/lib/stripe/client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * The Stripe Checkout Session of a card purchase and the write of its id onto the order
 * (spec 0011, AC-1, AC-7, AC-8), shared by the client checkout and the expert credit checkout
 * (spec 0018, AC-9). The ordering is load bearing and lives here once: the `pending` order was
 * inserted before this runs, **then** the session is created, **then** its id is stored, and the
 * payable URL is handed out only once that write is confirmed, because the sweep reads a null
 * session id as an order nobody can pay. Server only: it needs the service client, because app
 * roles cannot update orders.
 */

type Client = SupabaseClient<Database>;

/** The columns of the order the session is opened for; the row was inserted by the caller. */
export type SessionOrder = {
  readonly id: string;
  readonly reference: string;
  readonly gross_rappen: number | string;
  readonly package_name_snapshot: string;
  readonly locale: string;
};

/**
 * The column and value the session id write is scoped to beside the order id, so the write can
 * never land on an order the caller does not own: the buyer's organization for a client, the
 * buyer's own id for an expert.
 */
export type SessionScope =
  | { readonly column: "organization_id"; readonly value: string }
  | { readonly column: "buyer_expert_id"; readonly value: string };

export type SessionError = "stripe_unavailable" | "unexpected";

export type SessionOutcome =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: SessionError };

/**
 * Opens the session for `order` and stores its id under `scope`. A Stripe failure leaves the
 * pending order with a null session id for the sweep; a failed or zero row id write withholds
 * the URL. Never throws for an expected failure. Server only.
 */
export async function openCheckoutSession(input: {
  readonly order: SessionOrder;
  readonly successUrl: string;
  readonly cancelUrl: string;
  /** The service client, minted only when the id is written: a Stripe failure never reaches it. */
  readonly service: () => Client;
  readonly scope: SessionScope;
  /** The log prefix of the caller, so a failure names the path it happened on. */
  readonly context: string;
}): Promise<SessionOutcome> {
  const { order, service, scope, context } = input;
  const client = stripe();
  if (!client) return { ok: false, error: "stripe_unavailable" };

  let session: { id: string; url: string | null };
  try {
    session = await client.checkout.sessions.create(
      {
        mode: "payment",
        // The return page is the order's own page, so the return is a normal read of a row the
        // buyer already owns and the session_id Stripe appends is ignored entirely.
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        client_reference_id: order.id,
        locale: order.locale === "de" ? "de" : "en",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "chf",
              // Stripe's minor unit for CHF is the Rappen, so the integer passes unchanged: the
              // gross already includes the VAT we computed, which is why automatic_tax is off.
              unit_amount: Number(order.gross_rappen),
              product_data: { name: order.package_name_snapshot },
            },
          },
        ],
        metadata: { order_id: order.id, reference: order.reference },
      },
      // One session per order, whatever happens to the request.
      { idempotencyKey: `checkout/${order.id}` },
    );
  } catch (error) {
    Sentry.captureException(error);
    log.error(`${context}: stripe session creation failed`, { orderId: order.id });
    // The pending order stays with a null session id; the sweep expires it in an hour (AC-6).
    return { ok: false, error: "stripe_unavailable" };
  }

  try {
    // App roles cannot update orders. This server only write is scoped to the order just
    // inserted under the buyer's own policies, never an order id supplied by the caller.
    const { error: updateError } = await service()
      .from("orders")
      .update({ stripe_checkout_session_id: session.id })
      .eq("id", order.id)
      .eq(scope.column, scope.value)
      .select("id")
      .single();
    if (updateError) throw updateError;
  } catch (error) {
    // Never hand out a payable URL until persistence is confirmed: the sweep treats a null
    // session id as an unstarted checkout. A zero row update must fail here too.
    Sentry.captureException(error);
    log.error(`${context}: could not store the stripe session id`, {
      orderId: order.id,
      sessionId: session.id,
    });
    return { ok: false, error: "unexpected" };
  }

  if (!session.url) {
    log.error(`${context}: stripe returned no session url`, { orderId: order.id });
    return { ok: false, error: "stripe_unavailable" };
  }

  return { ok: true, url: session.url };
}
