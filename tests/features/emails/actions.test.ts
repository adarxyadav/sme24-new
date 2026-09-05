// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The three ops actions of `/admin/emails` (spec 0006, AC-10): each checks the ops role itself,
 * the retry only accepts a `failed` row and triggers with no Trigger.dev key, the test email goes
 * to the signed in ops user with literal data and the `ops.test_email` source event, and the test
 * alert answers `webhook_unset` without triggering when the server has no Slack webhook. The
 * action client, the two trigger helpers and the env are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  env: {} as Record<string, unknown>,
  delivery: null as { status: string } | null,
  profile: null as { full_name: string | null } | null,
  reads: [] as Array<{ table: string; columns: string; id: string }>,
  sendEmail: vi.fn(),
  retryEmail: vi.fn(),
  sendOpsAlert: vi.fn(),
}));

vi.mock("@/lib/supabase/action", () => ({
  createActionClient: async () => ({
    auth: {
      getClaims: async () => ({ data: boundary.claims ? { claims: boundary.claims } : null }),
    },
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => {
            boundary.reads.push({ table, columns, id });
            if (table === "email_deliveries") return { data: boundary.delivery, error: null };
            if (table === "profiles") return { data: boundary.profile, error: null };
            throw new Error(`unexpected table ${table}`);
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/email/send", () => ({
  sendEmail: boundary.sendEmail,
  retryEmail: boundary.retryEmail,
}));
vi.mock("@/lib/alerts/send", () => ({ sendOpsAlert: boundary.sendOpsAlert }));
vi.mock("@/lib/env", () => ({ serverEnv: () => boundary.env }));

const { retryDelivery, sendTestAlert, sendTestEmail } = await import("@/features/emails/actions");

const OPS_ID = "22222222-2222-4222-8222-222222222222";
const DELIVERY_ID = "d0000000-0000-4000-8000-000000000001";
const ops = { sub: OPS_ID, app_metadata: { role: "ops" } };
const client = { sub: OPS_ID, app_metadata: { role: "client" } };
const AT = new Date("2026-09-05T10:00:00Z");

beforeEach(() => {
  boundary.claims = ops;
  boundary.env = { OPS_ALERT_WEBHOOK_URL: "https://hooks.slack.example/T/B/x" };
  boundary.delivery = { status: "failed" };
  boundary.profile = { full_name: "  Olga Ops " };
  boundary.reads = [];
  boundary.sendEmail.mockResolvedValue({ ok: true, runId: "run_email" });
  boundary.retryEmail.mockResolvedValue({ ok: true, runId: "run_retry" });
  boundary.sendOpsAlert.mockResolvedValue({ ok: true, runId: "run_alert" });
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the ops role check (AC-10)", () => {
  it.each([
    ["a client", client],
    ["an expert", { sub: OPS_ID, app_metadata: { role: "expert" } }],
    ["a signed out visitor", null],
    ["a top level role claim", { sub: OPS_ID, role: "ops" }],
    ["ops claims without a subject", { app_metadata: { role: "ops" } }],
  ])("refuses %s on every action without reading or triggering anything", async (_, claims) => {
    boundary.claims = claims;
    await expect(retryDelivery({ deliveryId: DELIVERY_ID })).resolves.toEqual({
      ok: false,
      error: "forbidden",
    });
    await expect(sendTestEmail()).resolves.toEqual({ ok: false, error: "forbidden" });
    await expect(sendTestAlert()).resolves.toEqual({ ok: false, error: "forbidden" });
    expect(boundary.reads).toEqual([]);
    expect(boundary.retryEmail).not.toHaveBeenCalled();
    expect(boundary.sendEmail).not.toHaveBeenCalled();
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });
});

describe("retryDelivery (AC-10)", () => {
  it("triggers a retry for a failed row and answers with the run id", async () => {
    await expect(retryDelivery({ deliveryId: DELIVERY_ID })).resolves.toEqual({
      ok: true,
      data: { runId: "run_retry" },
    });
    expect(boundary.reads).toEqual([
      { table: "email_deliveries", columns: "status", id: DELIVERY_ID },
    ]);
    expect(boundary.retryEmail).toHaveBeenCalledWith(DELIVERY_ID);
  });

  it("rejects a non uuid id before touching the database", async () => {
    await expect(retryDelivery({ deliveryId: "1" })).resolves.toEqual({
      ok: false,
      error: "invalid",
    });
    expect(boundary.reads).toEqual([]);
  });

  it.each(["queued", "sending", "sent", "delivered", "bounced", "complained", "skipped"])(
    "refuses to retry a %s row",
    async (status) => {
      boundary.delivery = { status };
      await expect(retryDelivery({ deliveryId: DELIVERY_ID })).resolves.toEqual({
        ok: false,
        error: "not_retryable",
      });
      expect(boundary.retryEmail).not.toHaveBeenCalled();
    },
  );

  it("answers not_retryable for a row that does not exist or that RLS hides", async () => {
    boundary.delivery = null;
    await expect(retryDelivery({ deliveryId: DELIVERY_ID })).resolves.toEqual({
      ok: false,
      error: "not_retryable",
    });
  });

  it("passes a trigger failure through as the action error", async () => {
    boundary.retryEmail.mockResolvedValue({ ok: false, error: "trigger_unavailable" });
    await expect(retryDelivery({ deliveryId: DELIVERY_ID })).resolves.toEqual({
      ok: false,
      error: "trigger_unavailable",
    });
  });
});

describe("sendTestEmail (AC-10)", () => {
  it("sends the welcome template to the signed in ops user with literal data and the ops source event", async () => {
    await expect(sendTestEmail()).resolves.toEqual({ ok: true, data: { runId: "run_email" } });
    expect(boundary.sendEmail).toHaveBeenCalledWith({
      template: "welcome",
      data: { organizationName: "SME24 Test" },
      recipient: { userId: OPS_ID },
      sourceEvent: "ops.test_email",
      idempotencyKey: `ops-test-email/${OPS_ID}/${AT.getTime()}`,
    });
  });

  it("uses a fresh key per click so every click sends", async () => {
    await sendTestEmail();
    vi.setSystemTime(new Date(AT.getTime() + 1_000));
    await sendTestEmail();
    const keys = boundary.sendEmail.mock.calls.map(
      ([request]) => (request as { idempotencyKey: string }).idempotencyKey,
    );
    expect(new Set(keys).size).toBe(2);
  });

  it("passes a trigger failure through", async () => {
    boundary.sendEmail.mockResolvedValue({ ok: false, error: "trigger_failed" });
    await expect(sendTestEmail()).resolves.toEqual({ ok: false, error: "trigger_failed" });
  });
});

describe("sendTestAlert (AC-10)", () => {
  it("posts an ops.test alert named by the profile name, never the email, with a link to the outbox", async () => {
    await expect(sendTestAlert()).resolves.toEqual({ ok: true, data: { runId: "run_alert" } });
    expect(boundary.reads).toEqual([{ table: "profiles", columns: "full_name", id: OPS_ID }]);
    expect(boundary.sendOpsAlert).toHaveBeenCalledWith({
      kind: "ops.test",
      fields: { triggeredBy: "Olga Ops" },
      link: "/admin/emails",
      idempotencyKey: `ops-test/${OPS_ID}/${AT.getTime()}`,
    });
  });

  it("falls back to a neutral name when the profile has none", async () => {
    boundary.profile = { full_name: "  " };
    await sendTestAlert();
    expect(boundary.sendOpsAlert.mock.calls[0]?.[0]).toMatchObject({
      fields: { triggeredBy: "an ops user" },
    });
    boundary.profile = null;
    await sendTestAlert();
    expect(boundary.sendOpsAlert.mock.calls[1]?.[0]).toMatchObject({
      fields: { triggeredBy: "an ops user" },
    });
  });

  it("answers webhook_unset without reading the profile or triggering when the server has no webhook", async () => {
    boundary.env = {};
    await expect(sendTestAlert()).resolves.toEqual({ ok: false, error: "webhook_unset" });
    expect(boundary.reads).toEqual([]);
    expect(boundary.sendOpsAlert).not.toHaveBeenCalled();
  });

  it("passes a trigger failure through", async () => {
    boundary.sendOpsAlert.mockResolvedValue({ ok: false, error: "trigger_unavailable" });
    await expect(sendTestAlert()).resolves.toEqual({ ok: false, error: "trigger_unavailable" });
  });
});
