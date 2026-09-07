// @vitest-environment node

import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { orderIdFromEvent, sessionIsPaid } from "@/lib/stripe/event";

/**
 * The pure halves of the Stripe webhook (spec 0011, AC-5, AC-7): which order an event is about,
 * and whether a completed session actually carries money. The signature check and the database
 * writes are covered by the e2e specs and the pgTAP suite.
 */

function event(object: Record<string, unknown>, type = "checkout.session.completed"): Stripe.Event {
  return { id: "evt_1", type, created: 1_757_000_000, data: { object } } as unknown as Stripe.Event;
}

describe("orderIdFromEvent", () => {
  it("reads the order id from client_reference_id, which the checkout action sets", () => {
    expect(orderIdFromEvent(event({ client_reference_id: "order-1" }))).toBe("order-1");
  });

  it("falls back to the metadata when the reference is absent", () => {
    expect(orderIdFromEvent(event({ metadata: { order_id: "order-2" } }))).toBe("order-2");
  });

  it("prefers the reference over the metadata when both are present", () => {
    expect(
      orderIdFromEvent(
        event({ client_reference_id: "order-1", metadata: { order_id: "order-2" } }),
      ),
    ).toBe("order-1");
  });

  it("answers null when the event names no order, so the route records and acknowledges it", () => {
    expect(orderIdFromEvent(event({}))).toBeNull();
    expect(orderIdFromEvent(event({ client_reference_id: null, metadata: {} }))).toBeNull();
  });
});

describe("sessionIsPaid", () => {
  it("is true only once the money has actually arrived", () => {
    expect(sessionIsPaid(event({ payment_status: "paid" }))).toBe(true);
    expect(sessionIsPaid(event({ payment_status: "no_payment_required" }))).toBe(true);
  });

  it("is false while the payment is still pending, so the async event settles it later", () => {
    expect(sessionIsPaid(event({ payment_status: "unpaid" }))).toBe(false);
    expect(sessionIsPaid(event({ payment_status: null }))).toBe(false);
    expect(sessionIsPaid(event({}))).toBe(false);
  });
});
