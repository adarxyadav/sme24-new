// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { settleOrder } from "@/features/checkout/settle";

/**
 * The shared settlement core (spec 0011, AC-9 and AC-18, invariants 13 and 14). Both arrows into
 * `paid` run this one function, so what these lock in is that the wrapper passes the caller's own
 * inputs straight through to `public.settle_order` and translates its answer without inventing a
 * branch of its own: the webhook keeps the Stripe clock and a null actor, ops keep their user and
 * the role `ops`, a retry reports `alreadySettled` rather than failing, and a real state conflict
 * is told apart from an outage so the task retries the right one.
 */

const rpc = vi.fn();
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// The one boundary: the database. Everything else here is our own code, so nothing else is faked.
const service = { rpc } as never;

const SELLER = {
  name: "IC Hotz GmbH",
  address: "Obermühle 5, 6340 Baar",
  uid: "CHE-101.654.423 MWST",
  iban: "CH9300762011623852957",
};
const ORDER_ID = "0e000000-0000-4000-8000-000000000001";
const PAID_AT = new Date("2026-09-07T08:30:00.000Z");

/** The row shape `public.settle_order` returns. */
function settled(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      invoice_id: "0f000000-0000-4000-8000-000000000001",
      invoice_number: "2026-0001",
      qr_reference: "RF182026 0001",
      already_settled: false,
      ...overrides,
    },
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockReturnValue({ single: async () => settled() });
});

describe("settleOrder", () => {
  it("passes the webhook's own inputs to the database function, with a null actor", async () => {
    const result = await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30);

    expect(result).toEqual({
      ok: true,
      data: {
        orderId: ORDER_ID,
        invoiceId: "0f000000-0000-4000-8000-000000000001",
        invoiceNumber: "2026-0001",
        qrReference: "RF182026 0001",
        alreadySettled: false,
      },
    });
    expect(rpc).toHaveBeenCalledWith("settle_order", {
      order_id: ORDER_ID,
      // The Stripe clock, not ours: an event delivered late still records when it was paid.
      paid_at: "2026-09-07T08:30:00.000Z",
      // No human confirmed it, so the trail records the service role against a null actor.
      actor_id: null,
      actor_role: "service",
      seller_name: SELLER.name,
      seller_address: SELLER.address,
      seller_uid: SELLER.uid,
      seller_iban: SELLER.iban,
      due_days: 30,
    });
  });

  it("passes the acting ops user through on the ops path (AC-13)", async () => {
    await settleOrder(
      service,
      ORDER_ID,
      PAID_AT,
      { role: "ops", userId: "ops-user-id" },
      SELLER,
      30,
    );

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      actor_id: "ops-user-id",
      actor_role: "ops",
    });
  });

  it("reports a retry as already settled rather than as a failure (AC-18)", async () => {
    // The order was paid by an earlier run; the function returns the existing invoice.
    rpc.mockReturnValue({ single: async () => settled({ already_settled: true }) });

    const result = await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30);

    expect(result.ok).toBe(true);
    expect(result.ok && result.data).toMatchObject({
      alreadySettled: true,
      // The same number the first run drew: no second number is issued, so the series stays gapless.
      invoiceNumber: "2026-0001",
    });
  });

  it("reports order_not_found for the SM404 the function raises", async () => {
    rpc.mockReturnValue({
      single: async () => ({ data: null, error: { code: "SM404", message: "no such order" } }),
    });

    const result = await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30);

    expect(result).toEqual({ ok: false, error: "order_not_found" });
  });

  it("reports order_not_pending for the SM409 a cancelled or expired order raises", async () => {
    rpc.mockReturnValue({
      single: async () => ({ data: null, error: { code: "SM409", message: "not pending" } }),
    });

    const result = await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30);

    // A real state conflict, told apart from an outage so the caller does not retry it forever.
    expect(result).toEqual({ ok: false, error: "order_not_pending" });
  });

  it("reports unexpected for any other database error, so the task retries", async () => {
    rpc.mockReturnValue({
      single: async () => ({ data: null, error: { code: "57014", message: "query cancelled" } }),
    });

    const result = await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30);

    expect(result).toEqual({ ok: false, error: "unexpected" });
  });

  it("reports unexpected when the function answered with no row at all", async () => {
    rpc.mockReturnValue({ single: async () => ({ data: null, error: null }) });

    const result = await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30);

    expect(result).toEqual({ ok: false, error: "unexpected" });
  });

  it("never throws for an expected failure, whichever error the database raises", async () => {
    for (const code of ["SM404", "SM409", "23505", "57014"]) {
      rpc.mockReturnValue({ single: async () => ({ data: null, error: { code, message: code } }) });

      await expect(
        settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 30),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it("passes the configured due days through, so the invoice due date is not hard coded", async () => {
    await settleOrder(service, ORDER_ID, PAID_AT, { role: "service" }, SELLER, 14);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ due_days: 14 });
  });
});
