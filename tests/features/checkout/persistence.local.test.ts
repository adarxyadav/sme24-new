// @vitest-environment node
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import en from "../../../messages/en-CH.json";

/**
 * Spec 0011, AC-1, AC-2, AC-6, AC-7, AC-12. Opt in with CHECKOUT_LOCAL_REGRESSION=1.
 * Run a real Next.js app with the same local Supabase URL and keys as this process, set
 * CHECKOUT_LOCAL_APP_URL to its URL, and supply a Stripe test key and E2E_SEED_PASSWORD.
 * Vitest hosts this Playwright flow so the real sweep task can run with an advanced clock.
 * Only the scheduler, telemetry and sweep client factory are replaced. The sweep factory
 * adds a company filter to real PostgREST reads and writes to protect unrelated local orders.
 * No payment is submitted. Cleanup expires this test's session and removes only its fixtures.
 */
const boundary = vi.hoisted(() => ({
  service: vi.fn(),
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@trigger.dev/sdk", () => ({
  schedules: { task: (options: unknown) => options },
  logger: { error: vi.fn() },
}));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: boundary.service }));
vi.mock("@/lib/env", () => ({
  taskEnv: () => ({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  }),
}));
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn() } }));

function localUrl(value: string | undefined): string {
  if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
    throw new Error("The checkout regression requires explicit local app and Supabase URLs");
  }
  return value;
}

function scopedSweepClient(service: SupabaseClient<Database>, companyId: string) {
  return {
    from: (table: "orders" | "order_events") => {
      if (table === "order_events") return service.from(table);
      return {
        select: (columns: string) =>
          service.from("orders").select(columns).eq("company_id", companyId),
        update: (values: Database["public"]["Tables"]["orders"]["Update"]) =>
          service.from("orders").update(values).eq("company_id", companyId),
      };
    },
  };
}

describe.skipIf(process.env.CHECKOUT_LOCAL_REGRESSION !== "1")(
  "real checkout persistence and sweep (AC-1, AC-2, AC-6, AC-7, AC-12)",
  () => {
    it("persists before payment navigation, denies buyer updates and survives the real sweep beyond an hour", async () => {
      const appUrl = localUrl(process.env.CHECKOUT_LOCAL_APP_URL);
      const dbUrl = localUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
      const secret = process.env.SUPABASE_SECRET_KEY;
      const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      const stripeKey = process.env.STRIPE_SECRET_KEY;
      const password = process.env.E2E_SEED_PASSWORD;
      if (!secret || !publicKey || !password || !stripeKey || !/^(sk|rk)_test_/.test(stripeKey)) {
        throw new Error(
          "Local Supabase keys, a seeded password and a Stripe test key are required",
        );
      }
      const options = { auth: { persistSession: false, autoRefreshToken: false } };
      const service = createClient<Database>(dbUrl, secret, options);
      const buyer = createClient<Database>(dbUrl, publicKey, options);
      const stripe = new Stripe(stripeKey);
      const companyId = randomUUID();
      const companyName = `Checkout regression ${companyId}`;
      const browser = await chromium.launch();
      const page = await browser.newPage();
      const reachedPayment = Promise.withResolvers<string>();
      const releasePayment = Promise.withResolvers<void>();
      const sessionIds = new Set<string>();
      try {
        const { data: auth, error: authError } = await buyer.auth.signInWithPassword({
          email: "client@example.com",
          password,
        });
        expect(authError).toBeNull();
        expect(auth.user).not.toBeNull();
        const { data: profile, error: profileError } = await service
          .from("profiles")
          .select("organization_id")
          .eq("id", auth.user?.id ?? "")
          .single();
        expect(profileError).toBeNull();
        const organizationId = profile?.organization_id;
        if (!organizationId || !auth.user) throw new Error("Seeded client needs an organization");
        const { error: companyError } = await service.from("companies").insert({
          id: companyId,
          organization_id: organizationId,
          created_by: auth.user.id,
          name: companyName,
        });
        expect(companyError).toBeNull();

        await page.goto(`${appUrl}/en/sign-in`);
        await page.getByLabel("Email", { exact: true }).fill("client@example.com");
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.waitForURL(/\/en\/app$/);
        await page.goto(`${appUrl}/en/app/checkout?package=culture`);
        const companyPicker = page.getByRole("combobox", { name: en.checkout.companyLabel });
        if (await companyPicker.count()) {
          await companyPicker.click();
          await page.getByRole("option", { name: companyName, exact: true }).click();
        }
        await page.getByLabel(en.checkout.fields.billingName, { exact: true }).fill(companyName);
        await page
          .getByLabel(en.checkout.fields.billingStreet, { exact: true })
          .fill("Bahnhofstrasse 1");
        await page.getByLabel(en.checkout.fields.billingPostcode, { exact: true }).fill("8001");
        await page.getByLabel(en.checkout.fields.billingTown, { exact: true }).fill("Zürich");
        await page.getByLabel(en.checkout.fields.billingUid, { exact: true }).fill("");

        // Pause only Stripe's document request: the app's action and every DB request are real.
        // Assertions below therefore happen before the browser can render the payment page.
        await page.route("https://checkout.stripe.com/**", async (route) => {
          const id = new URL(route.request().url()).pathname.match(/\/(cs_test_[^/]+)/)?.[1];
          if (id) {
            sessionIds.add(id);
            reachedPayment.resolve(id);
            await releasePayment.promise;
          }
          await route.continue();
        });
        await page.getByRole("button", { name: en.checkout.submitCard, exact: true }).click();
        const sessionId = await Promise.race([
          reachedPayment.promise,
          page
            .getByRole("alert")
            .filter({ hasText: /\S/ })
            .waitFor({ state: "visible", timeout: 60_000 })
            .then(async () => {
              throw new Error(
                `Checkout stayed on its error: ${await page.getByRole("alert").filter({ hasText: /\S/ }).innerText()}`,
              );
            }),
        ]);
        const { data: order, error: orderError } = await service
          .from("orders")
          .select("*")
          .eq("company_id", companyId)
          .single();
        expect(orderError).toBeNull();
        expect(order).toMatchObject({
          status: "pending",
          stripe_checkout_session_id: sessionId,
          organization_id: organizationId,
          net_rappen: 200000,
          vat_rappen: 16200,
          gross_rappen: 216200,
        });
        if (!order) throw new Error("Checkout did not insert the order");
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        expect(session).toMatchObject({
          livemode: false,
          status: "open",
          client_reference_id: order.id,
          currency: "chf",
          amount_total: 216200,
        });

        const denied = await buyer
          .from("orders")
          .update({ stripe_checkout_session_id: "cs_test_forged" })
          .eq("id", order.id);
        expect(denied.status).toBe(403);
        expect(denied.error?.code).toBe("42501");

        // A real unstarted control proves the sweep actually ran and the advanced clock mattered.
        const controlId = randomUUID();
        const reference = await service.rpc("next_order_reference");
        expect(reference.error).toBeNull();
        const { error: controlError } = await service.from("orders").insert({
          ...order,
          id: controlId,
          reference: reference.data as string,
          stripe_checkout_session_id: null,
        });
        expect(controlError).toBeNull();
        boundary.service.mockImplementation(() => scopedSweepClient(service, companyId));
        const { sweepOrdersTask } = await import("@/trigger/sweep-orders");
        const sweep = sweepOrdersTask as unknown as { run: () => Promise<{ expired: number }> };
        const future = new Date(order.created_at).getTime() + 2 * 60 * 60_000;
        const clock = vi.spyOn(Date, "now").mockReturnValue(future);
        try {
          expect(await sweep.run()).toEqual({ expired: 1 });
        } finally {
          clock.mockRestore();
        }
        const { data: after, error: afterError } = await service
          .from("orders")
          .select("id, status, stripe_checkout_session_id")
          .eq("company_id", companyId);
        expect(afterError).toBeNull();
        expect(after).toEqual(
          expect.arrayContaining([
            { id: order.id, status: "pending", stripe_checkout_session_id: sessionId },
            { id: controlId, status: "expired", stripe_checkout_session_id: null },
          ]),
        );
        expect((await stripe.checkout.sessions.retrieve(sessionId)).status).toBe("open");
        releasePayment.resolve();
        await page.waitForURL(/https:\/\/checkout\.stripe\.com\//);
        await page.waitForLoadState("domcontentloaded");
      } finally {
        releasePayment.resolve();
        // Also recover an id if the browser failed between the write and the navigation.
        const { data: rows } = await service
          .from("orders")
          .select("stripe_checkout_session_id")
          .eq("company_id", companyId);
        for (const row of rows ?? [])
          if (row.stripe_checkout_session_id) sessionIds.add(row.stripe_checkout_session_id);
        try {
          for (const id of sessionIds) {
            if ((await stripe.checkout.sessions.retrieve(id)).status === "open")
              await stripe.checkout.sessions.expire(id);
          }
        } finally {
          await browser.close();
          const { error: ordersError } = await service
            .from("orders")
            .delete()
            .eq("company_id", companyId);
          expect(ordersError).toBeNull();
          const { error: deleteError } = await service
            .from("companies")
            .delete()
            .eq("id", companyId);
          expect(deleteError).toBeNull();
          await buyer.auth.signOut({ scope: "local" });
        }
      }
    }, 120_000);
  },
);
