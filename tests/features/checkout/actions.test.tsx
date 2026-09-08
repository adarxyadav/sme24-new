import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator, NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

// Spec 0011 regression handoff: use the real action, schema and form. Only database,
// Stripe, request context, navigation and telemetry are replaced at their boundaries.
const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  read: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  service: vi.fn(),
  session: vi.fn(),
  capture: vi.fn(),
  error: vi.fn(),
  push: vi.fn(),
  updates: [] as { table: string; values: Record<string, unknown>; filters: [string, unknown][] }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: boundary.claims } }) },
    rpc: async () => ({ data: "SME24-2026-0042", error: null }),
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: () => boundary.read(table) }) }),
      insert: (values: Record<string, unknown>) => {
        if (table === "order_events") return Promise.resolve({ error: null });
        return { select: () => ({ single: () => boundary.insert(values) }) };
      },
    }),
  }),
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: boundary.service }));
vi.mock("@/lib/stripe/client", () => ({
  stripeConfigured: () => true,
  stripe: () => ({ checkout: { sessions: { create: boundary.session } } }),
}));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    SUPABASE_SECRET_KEY: "service-secret",
    NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321",
  }),
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.capture }));
vi.mock("@/lib/logger", () => ({ log: { error: boundary.error, info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push: boundary.push }) }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en-CH",
  getTranslations: async ({ locale }: { locale: "en-CH" | "de-CH" }) =>
    createTranslator({
      locale,
      messages: locale === "de-CH" ? de : en,
      namespace: "marketing.packages",
    }),
}));

const { startCheckout } = await import("@/features/checkout/actions");
const { CheckoutForm } = await import("@/features/checkout/ui/checkout-form");
const ORGANIZATION_ID = "0a000000-0000-4000-8000-000000000001";
const COMPANY_ID = "0c000000-0000-4000-8000-000000000001";
const ORDER_ID = "0e000000-0000-4000-8000-000000000042";
const SESSION_ID = "cs_test_regression";
const PAYMENT_URL = "https://checkout.stripe.com/c/pay/cs_test_regression";
const INPUT = {
  companyId: COMPANY_ID,
  packageKey: "culture",
  locale: "en-CH",
  billingName: "Buyer AG",
  billingStreet: "Bahnhofstrasse 1",
  billingPostcode: "8001",
  billingTown: "Zürich",
  billingCountry: "CH",
  billingUid: "",
};
const order = {
  id: ORDER_ID,
  reference: "SME24-2026-0042",
  gross_rappen: 216200,
  package_name_snapshot: "Safety Culture",
  locale: "en",
};
const failures = [
  {
    name: "a database error",
    error: { code: "42501", message: "permission denied" },
    rejected: false,
  },
  {
    name: "zero matched rows",
    error: {
      code: "PGRST116",
      message: "Cannot coerce the result to a single JSON object",
      details: "The result contains 0 rows",
    },
    rejected: false,
  },
  { name: "a rejected update promise", error: new Error("connection reset"), rejected: true },
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom has no ResizeObserver; Radix measures the package radio group with one.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  boundary.claims = {
    sub: "buyer-id",
    app_metadata: { role: "client", organization_id: ORGANIZATION_ID },
  };
  boundary.updates = [];
  boundary.read.mockImplementation(async (table: string) => ({
    data:
      table === "packages"
        ? { price_rappen: 200000, vat_rate: 0.081, is_active: true }
        : { id: COMPANY_ID },
    error: null,
  }));
  boundary.insert.mockResolvedValue({ data: order, error: null });
  boundary.session.mockResolvedValue({ id: SESSION_ID, url: PAYMENT_URL });
  boundary.update.mockResolvedValue({ data: { id: ORDER_ID }, error: null });
  boundary.service.mockImplementation(() => ({
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const write = { table, values, filters: [] as [string, unknown][] };
        boundary.updates.push(write);
        const chain = {
          eq: (key: string, value: unknown) => {
            write.filters.push([key, value]);
            return chain;
          },
          select: () => chain,
          single: () => boundary.update(),
        };
        return chain;
      },
    }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

function failPersistence(failure: (typeof failures)[number]) {
  if (failure.rejected) boundary.update.mockRejectedValue(failure.error);
  else boundary.update.mockResolvedValue({ data: null, error: failure.error });
}

describe("startCheckout persistence (AC-1, AC-6, AC-7, AC-12)", () => {
  it("hands out the payment URL only after the session write completes", async () => {
    const completion = Promise.withResolvers<{ data: { id: string }; error: null }>();
    boundary.update.mockReturnValue(completion.promise);
    const finished = vi.fn();
    const pending = startCheckout(null, INPUT).then((result) => {
      finished(result);
      return result;
    });
    await waitFor(() => expect(boundary.update).toHaveBeenCalledOnce());
    expect(finished).not.toHaveBeenCalled();
    completion.resolve({ data: { id: ORDER_ID }, error: null });
    await expect(pending).resolves.toEqual({
      ok: true,
      data: {
        checkoutUrl: PAYMENT_URL,
        orderId: ORDER_ID,
        reference: order.reference,
      },
    });
  });

  it("writes only the returned session to this call's order and authenticated organization", async () => {
    await startCheckout(null, {
      ...INPUT,
      orderId: "someone-elses-order",
      organization_id: "foreign-org",
      stripe_checkout_session_id: "forged-session",
      status: "paid",
      gross_rappen: 1,
    });
    expect(boundary.updates).toEqual([
      {
        table: "orders",
        values: { stripe_checkout_session_id: SESSION_ID },
        filters: [
          ["id", ORDER_ID],
          ["organization_id", ORGANIZATION_ID],
        ],
      },
    ]);
    expect(boundary.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: ORGANIZATION_ID,
        created_by: "buyer-id",
        company_id: COMPANY_ID,
        net_rappen: 200000,
        vat_rappen: 16200,
        gross_rappen: 216200,
      }),
    );
    expect(boundary.session).toHaveBeenCalledWith(
      expect.objectContaining({
        client_reference_id: ORDER_ID,
        line_items: [
          expect.objectContaining({
            price_data: expect.objectContaining({ currency: "chf", unit_amount: 216200 }),
          }),
        ],
      }),
      { idempotencyKey: `checkout/${ORDER_ID}` },
    );
  });

  for (const failure of failures) {
    it(`withholds the URL and reports order and session context for ${failure.name}`, async () => {
      failPersistence(failure);
      await expect(startCheckout(null, INPUT)).resolves.toEqual({ ok: false, error: "unexpected" });
      expect(boundary.session).toHaveBeenCalledOnce();
      expect(boundary.capture).toHaveBeenCalledExactlyOnceWith(failure.error);
      expect(boundary.error).toHaveBeenCalledExactlyOnceWith(
        "checkout: could not store the stripe session id",
        { orderId: ORDER_ID, sessionId: SESSION_ID },
      );
    });
  }

  it.each([
    ["signed out", null],
    [
      "expert",
      { sub: "expert", app_metadata: { role: "expert", organization_id: ORGANIZATION_ID } },
    ],
    ["ops", { sub: "ops", app_metadata: { role: "ops", organization_id: ORGANIZATION_ID } }],
    ["missing organization", { sub: "buyer", app_metadata: { role: "client" } }],
    ["missing subject", { app_metadata: { role: "client", organization_id: ORGANIZATION_ID } }],
    [
      "forged user metadata",
      { sub: "buyer", user_metadata: { role: "client", organization_id: ORGANIZATION_ID } },
    ],
    [
      "top level role",
      { sub: "buyer", role: "client", app_metadata: { organization_id: ORGANIZATION_ID } },
    ],
  ])("refuses %s before any privileged work", async (_name, claims) => {
    boundary.claims = claims;
    await expect(startCheckout(null, INPUT)).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(boundary.insert).not.toHaveBeenCalled();
    expect(boundary.session).not.toHaveBeenCalled();
    expect(boundary.service).not.toHaveBeenCalled();
  });

  it("never escalates a denied RLS insert into a privileged write", async () => {
    boundary.insert.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "new row violates row-level security policy" },
    });
    await expect(startCheckout(null, INPUT)).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(boundary.session).not.toHaveBeenCalled();
    expect(boundary.service).not.toHaveBeenCalled();
  });

  it.each([
    ["en-CH", "en"],
    ["de-CH", "de"],
  ])("sends Stripe a return URL using the %s URL prefix", async (locale, prefix) => {
    // Regression (spec 0011 verify, 2026-09-08): the return URLs interpolated the next-intl
    // locale (`en-CH`) instead of the URL segment (`en`), so every card buyer landed on
    // `/en/en-CH/app/orders/<id>`, which 404s.
    process.env.NEXT_PUBLIC_APP_URL = "https://sme24.example";
    await startCheckout(null, { ...INPUT, locale });
    const expected = `https://sme24.example/${prefix}/app/orders/${ORDER_ID}`;
    expect(boundary.session).toHaveBeenCalledWith(
      expect.objectContaining({ success_url: expected, cancel_url: expected }),
      expect.anything(),
    );
  });

  it("never reaches a privileged write if Stripe creation rejects", async () => {
    boundary.session.mockRejectedValue(new Error("Stripe unavailable"));
    await expect(startCheckout(null, INPUT)).resolves.toEqual({
      ok: false,
      error: "stripe_unavailable",
    });
    expect(boundary.service).not.toHaveBeenCalled();
  });
});

for (const [locale, messages] of [
  ["en-CH", en],
  ["de-CH", de],
] as const) {
  describe(`checkout failure in ${locale} (AC-1, AC-6)`, () => {
    for (const failure of failures) {
      it(`keeps the entered form and announces the localized error for ${failure.name}`, async () => {
        failPersistence(failure);
        const user = userEvent.setup();
        const initialUrl = window.location.href;
        render(
          <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Zurich">
            <CheckoutForm
              companies={[{ id: COMPANY_ID, name: INPUT.billingName, uid: null }]}
              packages={[
                {
                  key: "culture",
                  name: "Safety Culture",
                  priceRappen: 200000,
                  vatRate: 0.081,
                  priceLabel: "CHF 2'000.00",
                  netLabel: "CHF 2'000.00",
                  vatLabel: "CHF 162.00",
                  grossLabel: "CHF 2'162.00",
                  vatRateLabel: "8.1%",
                },
              ]}
            />
          </NextIntlClientProvider>,
        );
        await user.type(
          screen.getByLabelText(messages.checkout.fields.billingStreet),
          INPUT.billingStreet,
        );
        await user.type(
          screen.getByLabelText(messages.checkout.fields.billingPostcode),
          INPUT.billingPostcode,
        );
        await user.type(
          screen.getByLabelText(messages.checkout.fields.billingTown),
          INPUT.billingTown,
        );
        await user.click(screen.getByRole("button", { name: messages.checkout.submitCard }));
        expect(await screen.findByRole("alert")).toHaveTextContent(
          messages.checkout.errors.unexpected,
        );
        expect(boundary.session).toHaveBeenCalledOnce();
        expect(boundary.capture).toHaveBeenCalledWith(failure.error);
        expect(screen.getByLabelText(messages.checkout.fields.billingStreet)).toHaveValue(
          INPUT.billingStreet,
        );
        expect(screen.getByRole("button", { name: messages.checkout.submitCard })).toBeEnabled();
        expect(boundary.push).not.toHaveBeenCalled();
        expect(window.location.href).toBe(initialUrl);
      });
    }
  });
}
