import { handleStripeWebhook } from "@/lib/stripe/webhook";

export const dynamic = "force-dynamic";

/**
 * Stripe payment events (spec 0011, AC-5): the signature is checked against the raw body, the
 * event id deduplicates, and the confirmation runs in a task. The only path to a paid order.
 */
export async function POST(request: Request): Promise<Response> {
  return handleStripeWebhook(request);
}
