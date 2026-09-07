// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `markOrderPaid` (spec 0011, AC-9): settling on the ops path must do the same follow up work the
 * `confirm-order` task does on the webhook path, under the same idempotency keys, so a bank
 * transfer buyer gets the same confirmation a card buyer gets. The regression these guard is a
 * settle that returned early and sent nothing.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  claims: { sub: "ops-user-id", app_metadata: { role: "ops" } } as Record<string, unknown> | null,
  order: null as Row | null,
  organizationName: "Musterfirma AG" as string | null,
  /** What the `orders` update answers on the cancel path: a row when it was still pending. */
  cancelUpdate: { data: null as Row | null, error: null as { message: string } | null },
  /** What reading one invoice answers on the retry path. */
  invoiceRead: { data: null as Row | null, error: null as { message: string } | null },
  updates: [] as { table: string; values: Row; filters: Row }[],
  inserts: [] as { table: string; values: Row }[],
  settle: vi.fn(),
  sendEmail: vi.fn(),
  sendOpsAlert: vi.fn(),
  renderTrigger: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "orders") return { data: boundary.order, error: null };
            if (table === "invoices") return boundary.invoiceRead;
            return { data: { name: boundary.organizationName }, error: null };
          },
        }),
      }),
      // The update chain the actions use. Every `.eq()` filter is recorded, so a test can prove
      // the cancel is guarded on the current status rather than only on the id. The chain is
      // built on a real resolved promise because `invoices` is updated without a `.select()`,
      // so awaiting the builder itself has to work, exactly as it does in PostgREST.
      update: (values: Row) => {
        const filters: Row = {};
        const chain = Object.assign(Promise.resolve({ data: null, error: null }), {
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            boundary.updates.push({ table, values, filters });
            return chain;
          },
          select: () => chain,
          maybeSingle: async () =>
            table === "orders"
              ? boundary.cancelUpdate
              : { data: { id: "invoice-id" }, error: null },
        });
        return chain;
      },
      insert: async (values: Row) => {
        boundary.inserts.push({ table, values });
        return { data: null, error: null };
      },
    }),
  }),
}));
vi.mock("@/features/checkout/settle", () => ({ settleOrder: boundary.settle }));
vi.mock("@/lib/email/send", () => ({ sendEmail: boundary.sendEmail }));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.sendOpsAlert }));
vi.mock("@/trigger/render-invoice", () => ({
  renderInvoiceTask: { trigger: boundary.renderTrigger },
}));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    SUPABASE_SECRET_KEY: "secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.captureException }));
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/features/checkout/seller", () => ({
  seller: () => ({ name: "SME24 AG", address: "Street", uid: "CHE-1", iban: "CH93" }),
  invoiceDueDays: () => 30,
}));

const ORDER_ID = "0e000000-0000-4000-8000-000000000001";
const INVOICE_ID = "0f000000-0000-4000-8000-000000000001";
const { markOrderPaid, cancelOrder, retryInvoiceRender } = await import(
  "@/features/checkout/ops-actions"
);

beforeEach(() => {
  vi.clearAllMocks();
  boundary.claims = { sub: "ops-user-id", app_metadata: { role: "ops" } };
  boundary.organizationName = "Musterfirma AG";
  boundary.updates = [];
  boundary.inserts = [];
  boundary.cancelUpdate = { data: { id: ORDER_ID, organization_id: "org-id" }, error: null };
  boundary.invoiceRead = {
    data: { id: INVOICE_ID, pdf_path: null, pdf_failed_at: "2026-09-07T09:00:00.000Z" },
    error: null,
  };
  boundary.order = {
    id: ORDER_ID,
    organization_id: "org-id",
    created_by: "buyer-id",
    reference: "SME24-2026-0001",
    package_name_snapshot: "Safety Culture",
    net_rappen: 200000,
    vat_rappen: 16200,
    gross_rappen: 216200,
    vat_rate: 0.081,
  };
  boundary.settle.mockResolvedValue({
    ok: true,
    data: {
      orderId: ORDER_ID,
      invoiceId: "invoice-id",
      invoiceNumber: "2026-0001",
      qrReference: "RF18",
      alreadySettled: false,
    },
  });
  boundary.sendEmail.mockResolvedValue({ ok: true, runId: "run" });
  boundary.sendOpsAlert.mockResolvedValue({ ok: true, runId: "run" });
  boundary.renderTrigger.mockResolvedValue({ id: "run" });
});

describe("markOrderPaid", () => {
  it("sends the confirmation email under the key the webhook path uses", async () => {
    const result = await markOrderPaid(null, { orderId: ORDER_ID });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(boundary.sendEmail).toHaveBeenCalledTimes(1);
    const sent = boundary.sendEmail.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      template: "order_confirmed",
      sourceEvent: "order.confirmed",
      recipient: { userId: "buyer-id" },
      // The same string the confirm-order task uses, so the two paths share one delivery row.
      idempotencyKey: `order-confirmed/${ORDER_ID}`,
    });
    // The amounts come from the frozen Rappen, in francs.
    expect(sent.data).toMatchObject({
      invoiceNumber: "2026-0001",
      netChf: 2000,
      vatChf: 162,
      grossChf: 2162,
    });
  });

  it("raises the payment.received alert under the key the webhook path uses", async () => {
    await markOrderPaid(null, { orderId: ORDER_ID });

    expect(boundary.sendOpsAlert).toHaveBeenCalledTimes(1);
    expect(boundary.sendOpsAlert.mock.calls[0]?.[0]).toEqual({
      kind: "payment.received",
      idempotencyKey: `payment-received/${ORDER_ID}`,
      fields: {
        organizationName: "Musterfirma AG",
        amountChf: 2162,
        reference: "SME24-2026-0001",
      },
    });
  });

  it("queues the invoice render under the invoice keyed key", async () => {
    await markOrderPaid(null, { orderId: ORDER_ID });

    expect(boundary.renderTrigger).toHaveBeenCalledWith(
      { invoiceId: "invoice-id" },
      { idempotencyKey: "invoice-render/invoice-id" },
    );
  });

  it("still reports success when the follow up cannot be queued", async () => {
    // The money is already recorded, so a Trigger.dev outage must not tell ops it failed.
    boundary.renderTrigger.mockRejectedValue(new Error("trigger unreachable"));
    boundary.sendEmail.mockResolvedValue({ ok: false, error: "trigger_failed" });
    boundary.sendOpsAlert.mockResolvedValue({ ok: false, error: "trigger_failed" });

    await expect(markOrderPaid(null, { orderId: ORDER_ID })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
  });

  it("sends nothing when the order has no buyer, and still alerts", async () => {
    boundary.order = { ...(boundary.order as Row), created_by: null };

    const result = await markOrderPaid(null, { orderId: ORDER_ID });

    expect(result.ok).toBe(true);
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the settle failed", async () => {
    boundary.settle.mockResolvedValue({ ok: false, error: "order_not_pending" });

    const result = await markOrderPaid(null, { orderId: ORDER_ID });

    expect(result).toEqual({ ok: false, error: "not_pending" });
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
    expect(boundary.renderTrigger).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not ops", async () => {
    boundary.claims = { sub: "someone", app_metadata: { role: "client" } };

    const result = await markOrderPaid(null, { orderId: ORDER_ID });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.settle).not.toHaveBeenCalled();
    expect(boundary.sendEmail).not.toHaveBeenCalled();
  });
});

/**
 * `cancelOrder` (spec 0011, AC-9 and AC-13). Cancellation exists instead of deletion because Swiss
 * bookkeeping rules require a cancelled invoice to be retained, so the guard these lock in is that
 * the invoice row survives with `cancelled_at` set, and that a race with a landing payment cannot
 * cancel an order that has already been paid.
 */
describe("cancelOrder", () => {
  it("cancels a pending order and keeps its invoice, marked cancelled", async () => {
    const result = await cancelOrder(null, {
      orderId: ORDER_ID,
      reason: "No payment after 60 days",
    });

    expect(result).toEqual({ ok: true, data: undefined });
    const orderUpdate = boundary.updates.find((u) => u.table === "orders");
    expect(orderUpdate?.values).toMatchObject({ status: "cancelled" });
    expect(orderUpdate?.values.cancelled_at).toEqual(expect.any(String));

    // The invoice is updated, never deleted: the row is retained under Swiss bookkeeping rules.
    const invoiceUpdate = boundary.updates.find((u) => u.table === "invoices");
    expect(invoiceUpdate?.values.cancelled_at).toEqual(expect.any(String));
    expect(invoiceUpdate?.filters).toMatchObject({ order_id: ORDER_ID });
  });

  it("guards the update on the pending status, so a landing payment is not overwritten", async () => {
    await cancelOrder(null, { orderId: ORDER_ID, reason: "stale" });

    // Both filters must be present; on the id alone a paid order would be cancelled by a race.
    expect(boundary.updates.find((u) => u.table === "orders")?.filters).toMatchObject({
      id: ORDER_ID,
      status: "pending",
    });
  });

  it("records the transition on order_events with the acting ops user (AC-13)", async () => {
    await cancelOrder(null, { orderId: ORDER_ID, reason: "Client withdrew" });

    expect(boundary.inserts).toHaveLength(1);
    expect(boundary.inserts[0]).toMatchObject({
      table: "order_events",
      values: {
        order_id: ORDER_ID,
        organization_id: "org-id",
        from_status: "pending",
        to_status: "cancelled",
        actor_id: "ops-user-id",
        actor_role: "ops",
        reason: "Client withdrew",
      },
    });
  });

  it("reports not_pending when the order was no longer pending, writing nothing else", async () => {
    // The guarded update matched no row: the order was paid, cancelled or expired already.
    boundary.cancelUpdate = { data: null, error: null };

    const result = await cancelOrder(null, { orderId: ORDER_ID, reason: "stale" });

    expect(result).toEqual({ ok: false, error: "not_pending" });
    expect(boundary.inserts).toHaveLength(0);
    expect(boundary.updates.some((u) => u.table === "invoices")).toBe(false);
  });

  it("reports unexpected when the update itself failed", async () => {
    boundary.cancelUpdate = { data: null, error: { message: "connection reset" } };

    const result = await cancelOrder(null, { orderId: ORDER_ID, reason: "stale" });

    expect(result).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
    expect(boundary.inserts).toHaveLength(0);
  });

  it("rejects a missing reason before touching the database", async () => {
    const result = await cancelOrder(null, { orderId: ORDER_ID, reason: "   " });

    expect(result).toEqual({ ok: false, error: "validation" });
    expect(boundary.updates).toHaveLength(0);
  });

  it("rejects an order id that is not a uuid", async () => {
    const result = await cancelOrder(null, { orderId: "not-a-uuid", reason: "stale" });

    expect(result).toEqual({ ok: false, error: "validation" });
    expect(boundary.updates).toHaveLength(0);
  });

  it("refuses a caller who is not ops, before any validation or write", async () => {
    boundary.claims = { sub: "someone", app_metadata: { role: "client" } };

    const result = await cancelOrder(null, { orderId: ORDER_ID, reason: "stale" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.updates).toHaveLength(0);
    expect(boundary.inserts).toHaveLength(0);
  });

  it("refuses a signed out caller", async () => {
    boundary.claims = null;

    const result = await cancelOrder(null, { orderId: ORDER_ID, reason: "stale" });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.updates).toHaveLength(0);
  });
});

/**
 * `retryInvoiceRender` (spec 0011, AC-10). A payment is never unwound by a failing render, so ops
 * can re run one; the hard rule is that an invoice already rendered is never redrawn, because the
 * document a client has downloaded must not change underneath them.
 */
describe("retryInvoiceRender", () => {
  it("queues the render again under a key unique to the attempt", async () => {
    const result = await retryInvoiceRender(null, { invoiceId: INVOICE_ID });

    expect(result).toEqual({ ok: true, data: undefined });
    expect(boundary.renderTrigger).toHaveBeenCalledTimes(1);
    const [payload, options] = boundary.renderTrigger.mock.calls[0] ?? [];
    expect(payload).toEqual({ invoiceId: INVOICE_ID });
    // A fresh key per attempt, so a deliberate retry is not swallowed by the first run's key.
    expect(options.idempotencyKey).toMatch(new RegExp(`^invoice-render-retry/${INVOICE_ID}/\\d+$`));
    expect(options.idempotencyKey).not.toBe(`invoice-render/${INVOICE_ID}`);
  });

  it("refuses to redraw an invoice that already has a PDF", async () => {
    boundary.invoiceRead = {
      data: { id: INVOICE_ID, pdf_path: "invoices/2026-0001.pdf", pdf_failed_at: null },
      error: null,
    };

    const result = await retryInvoiceRender(null, { invoiceId: INVOICE_ID });

    expect(result).toEqual({ ok: false, error: "already_rendered" });
    expect(boundary.renderTrigger).not.toHaveBeenCalled();
  });

  it("reports not_found for an invoice that does not exist", async () => {
    boundary.invoiceRead = { data: null, error: null };

    const result = await retryInvoiceRender(null, { invoiceId: INVOICE_ID });

    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(boundary.renderTrigger).not.toHaveBeenCalled();
  });

  it("reports unexpected when the invoice could not be read", async () => {
    boundary.invoiceRead = { data: null, error: { message: "connection reset" } };

    const result = await retryInvoiceRender(null, { invoiceId: INVOICE_ID });

    expect(result).toEqual({ ok: false, error: "unexpected" });
    expect(boundary.captureException).toHaveBeenCalledTimes(1);
    expect(boundary.renderTrigger).not.toHaveBeenCalled();
  });

  it("rejects an invoice id that is not a uuid", async () => {
    const result = await retryInvoiceRender(null, { invoiceId: "42" });

    expect(result).toEqual({ ok: false, error: "validation" });
    expect(boundary.renderTrigger).not.toHaveBeenCalled();
  });

  it("refuses a caller who is not ops", async () => {
    boundary.claims = { sub: "someone", app_metadata: { role: "expert" } };

    const result = await retryInvoiceRender(null, { invoiceId: INVOICE_ID });

    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.renderTrigger).not.toHaveBeenCalled();
  });
});
