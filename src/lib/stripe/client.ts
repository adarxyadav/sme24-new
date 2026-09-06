import "server-only";
import Stripe from "stripe";
import { serverEnv } from "@/lib/env";

/**
 * The Stripe client (spec 0011). One instance per process, created on first use, never at module
 * load: a module level client would run at build time and in every preview that has no key.
 *
 * The key is a restricted key (`rk_` prefix) scoped to Checkout Sessions and PaymentIntents, not
 * a full secret key, so a leak cannot move money out of the account. Stripe v22 requires the
 * `new` operator.
 *
 * Server only (an action, a route handler or a task); never imported by browser code, which needs
 * nothing from Stripe because Checkout is hosted.
 */

let client: Stripe | null = null;

/** True when Stripe is configured in this environment. Server only. */
export function stripeConfigured(): boolean {
  return Boolean(serverEnv().STRIPE_SECRET_KEY);
}

/**
 * The shared Stripe client, or null when no key is set, which is the normal state of a local
 * stack and of a preview without Stripe. Callers answer their own typed error rather than
 * throwing, so a missing key degrades the checkout button instead of taking a page down.
 * Server only.
 */
export function stripe(): Stripe | null {
  const key = serverEnv().STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) {
    client = new Stripe(key, {
      // Retries a network failure on an idempotent request; a Checkout Session create carries our
      // own idempotency key, so a retry cannot create two sessions.
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "sme24", url: "https://sme24.ch" },
    });
  }
  return client;
}

/**
 * Verifies a webhook signature against the raw request body and returns the event, or null when
 * the signature does not verify or the secret is unset. Never throws, so the route can answer 400
 * without a stack trace reaching Stripe. Uses the async variant, which works under every runtime
 * crypto provider. Server only.
 */
export async function verifyStripeEvent(
  rawBody: string,
  signature: string | null,
): Promise<Stripe.Event | null> {
  const secret = serverEnv().STRIPE_WEBHOOK_SECRET;
  const stripeClient = stripe();
  if (!secret || !signature || !stripeClient) return null;
  try {
    return await stripeClient.webhooks.constructEventAsync(rawBody, signature, secret);
  } catch {
    return null;
  }
}

/** Resets the memoised client, for tests only. */
export function resetStripeClient(): void {
  client = null;
}
