// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The credit pack actions (spec 0018, AC-9): the order row an expert's purchase inserts (the
 * expert buyer shape, the frozen credits, the fixed Swiss billing country, no organization), the
 * Stripe session written under the buyer's own id with the URL withheld until the write lands,
 * the assessment key refused before any insert, and the bank transfer path that leaves the
 * credits for ops to grant. Only the boundaries are replaced: the request context, Supabase,
 * Stripe, the task queue and telemetry.
 */
type Row = Record<string, unknown>;

const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  expertStatus: "active" as string,
  pack: null as Row | null,
  inserts: [] as { table: string; values: Row }[],
  updates: [] as { table: string; values: Row; filters: [string, unknown][] }[],
  updateAnswer: { data: { id: "order-1" } as Row | null, error: null as unknown },
  session: vi.fn(),
  serviceMinted: 0,
  issueTrigger: vi.fn(),
  capture: vi.fn(),
  captureEvent: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: boundary.claims } }) },
    rpc: async () => ({ data: "SME24-2026-0090", error: null }),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table === "expert_profiles") {
              return { data: { status: boundary.expertStatus }, error: null };
            }
            if (table === "packages") return { data: boundary.pack, error: null };
            return { data: null, error: null };
          },
        }),
      }),
      insert: (values: Row) => {
        boundary.inserts.push({ table, values });
        if (table === "order_events") return Promise.resolve({ error: null });
        return {
          select: () => ({
            single: async () => ({
              data: {
                id: "order-1",
                reference: "SME24-2026-0090",
                gross_rappen: values.gross_rappen,
                package_name_snapshot: values.package_name_snapshot,
                locale: values.locale,
              },
              error: null,
            }),
          }),
        };
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => {
    boundary.serviceMinted += 1;
    return {
      from: (table: string) => ({
        update: (values: Row) => {
          const filters: [string, unknown][] = [];
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value]);
              return chain;
            },
            select: () => chain,
            single: async () => {
              boundary.updates.push({ table, values, filters });
              return boundary.updateAnswer;
            },
          };
          return chain;
        },
      }),
    };
  },
}));
vi.mock("@/lib/stripe/client", () => ({
  stripeConfigured: () => true,
  stripe: () => ({ checkout: { sessions: { create: boundary.session } } }),
}));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    SUPABASE_SECRET_KEY: "service-secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
    INVOICE_DUE_DAYS: 30,
  }),
}));
vi.mock("@/trigger/issue-invoice", () => ({
  issueInvoiceTask: { trigger: boundary.issueTrigger },
}));
vi.mock("@/lib/analytics/server", () => ({ captureServerEvent: boundary.captureEvent }));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.capture }));
vi.mock("@/lib/logger", () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en-CH",
  getTranslations: async () => (key: string) =>
    key === "directory_50.name" ? "50 directory credits" : key,
}));

const { startCreditCheckout, requestCreditInvoice } = await import("@/features/directory/actions");

const EXPERT_ID = "e0000000-0000-4000-8000-000000000001";
const INPUT = {
  packKey: "directory_50",
  paymentMethod: "card",
  locale: "en-CH",
  billingName: "Erika Expert",
  billingStreet: "Bahnhofstrasse 1",
  billingPostcode: "6340",
  billingTown: "Baar",
  billingUid: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  boundary.claims = { sub: EXPERT_ID, app_metadata: { role: "expert" } };
  boundary.expertStatus = "active";
  boundary.pack = {
    key: "directory_50",
    kind: "directory_credits",
    credits: 50,
    price_rappen: 9950,
    vat_rate: 0.081,
    is_active: true,
  };
  boundary.inserts = [];
  boundary.updates = [];
  boundary.updateAnswer = { data: { id: "order-1" }, error: null };
  boundary.serviceMinted = 0;
  boundary.session.mockResolvedValue({
    id: "cs_test_credits",
    url: "https://checkout.stripe.com/c/pay/cs_test_credits",
  });
  process.env.NEXT_PUBLIC_APP_URL = "https://sme24.test";
});

describe("startCreditCheckout", () => {
  it("inserts the expert buyer shape with the frozen credits and the Swiss billing country", async () => {
    const result = await startCreditCheckout(null, INPUT);
    expect(result).toEqual({
      ok: true,
      data: {
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_credits",
        orderId: "order-1",
        reference: "SME24-2026-0090",
      },
    });
    const order = boundary.inserts.find((entry) => entry.table === "orders")?.values;
    expect(order).toMatchObject({
      buyer_expert_id: EXPERT_ID,
      credits: 50,
      package_key: "directory_50",
      payment_method: "card",
      net_rappen: 9950,
      vat_rappen: 806,
      gross_rappen: 10756,
      package_name_snapshot: "50 directory credits",
      billing_country: "CH",
      locale: "en",
      created_by: EXPERT_ID,
    });
    expect(order).not.toHaveProperty("organization_id");
    expect(order).not.toHaveProperty("company_id");
    const event = boundary.inserts.find((entry) => entry.table === "order_events")?.values;
    expect(event).toMatchObject({
      order_id: "order-1",
      to_status: "pending",
      actor_role: "expert",
    });
  });

  it("returns to the localised credits page and scopes the session id write to the buyer", async () => {
    await startCreditCheckout(null, { ...INPUT, locale: "de-CH" });
    const [params] = boundary.session.mock.calls[0] as [Record<string, unknown>];
    expect(params.success_url).toBe("https://sme24.test/de/expert/kontakte/guthaben?order=order-1");
    expect(params.cancel_url).toBe(params.success_url);
    expect(params.client_reference_id).toBe("order-1");
    expect(boundary.updates).toEqual([
      {
        table: "orders",
        values: { stripe_checkout_session_id: "cs_test_credits" },
        filters: [
          ["id", "order-1"],
          ["buyer_expert_id", EXPERT_ID],
        ],
      },
    ]);
  });

  it("withholds the payable url when the session id write fails, and never mints the service client before Stripe answers", async () => {
    boundary.updateAnswer = { data: null, error: { code: "PGRST116", message: "0 rows" } };
    const result = await startCreditCheckout(null, INPUT);
    expect(result).toEqual({ ok: false, error: "unexpected" });

    boundary.session.mockRejectedValueOnce(new Error("stripe down"));
    boundary.serviceMinted = 0;
    const failed = await startCreditCheckout(null, INPUT);
    expect(failed).toEqual({ ok: false, error: "stripe_unavailable" });
    expect(boundary.serviceMinted).toBe(0);
  });

  it("refuses an assessment package key before any insert, and a client caller outright", async () => {
    const result = await startCreditCheckout(null, { ...INPUT, packKey: "culture" });
    expect(result).toEqual({ ok: false, error: "invalid_billing_address" });
    expect(boundary.inserts).toEqual([]);

    boundary.claims = { sub: "client-1", app_metadata: { role: "client", organization_id: "o" } };
    expect(await startCreditCheckout(null, INPUT)).toEqual({ ok: false, error: "forbidden" });
  });

  it("refuses an expert whose profile is not active", async () => {
    boundary.expertStatus = "invited";
    expect(await startCreditCheckout(null, INPUT)).toEqual({ ok: false, error: "forbidden" });
    expect(boundary.inserts).toEqual([]);
  });

  it("refuses a package that is not a credit pack, even by a valid key", async () => {
    boundary.pack = { ...boundary.pack, kind: "assessment", credits: null };
    expect(await startCreditCheckout(null, INPUT)).toEqual({
      ok: false,
      error: "package_not_found",
    });
  });
});

describe("requestCreditInvoice", () => {
  it("inserts a pending bank transfer order with a due date and queues the invoice", async () => {
    const result = await requestCreditInvoice(null, { ...INPUT, paymentMethod: "bank_transfer" });
    expect(result).toEqual({
      ok: true,
      data: { orderId: "order-1", reference: "SME24-2026-0090" },
    });
    const order = boundary.inserts.find((entry) => entry.table === "orders")?.values;
    expect(order).toMatchObject({
      buyer_expert_id: EXPERT_ID,
      credits: 50,
      payment_method: "bank_transfer",
      billing_country: "CH",
    });
    expect(order?.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(boundary.issueTrigger).toHaveBeenCalledWith(
      { orderId: "order-1" },
      { idempotencyKey: "invoice-issue/order-1" },
    );
    // No Stripe, no service client: the credits arrive when ops mark the transfer paid.
    expect(boundary.session).not.toHaveBeenCalled();
    expect(boundary.serviceMinted).toBe(0);
  });
});
