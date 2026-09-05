// @vitest-environment node
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Resend webhook route (spec 0006, AC-8): a missing secret answers 503, a bad signature 401,
 * an unknown id 200; delivered, bounced and complained move a row forward by rank, a repeated or
 * older event is a no op, delivery delayed only logs. The signature is the Standard Webhooks
 * scheme Resend uses (Svix headers), computed here with the same secret the handler reads.
 */
const state = vi.hoisted(() => ({
  secret: "" as string | undefined,
  row: null as { id: string; status: string } | null,
  updates: [] as Array<{ patch: Record<string, unknown>; id: string; status: string }>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  serverEnv: () => ({
    RESEND_WEBHOOK_SECRET: state.secret,
    SUPABASE_SECRET_KEY: "service-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => fakeSupabase(),
}));

function fakeSupabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: state.row, error: null }) }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_column: string, id: string) => ({
          eq: async (_status: string, status: string) => {
            state.updates.push({ patch, id, status });
            return { error: null };
          },
        }),
      }),
    }),
  };
}

const SECRET_BYTES = Buffer.from("test-webhook-secret-bytes-1234567890");
const SECRET = `whsec_${SECRET_BYTES.toString("base64")}`;

function signedRequest(body: object, options: { secret?: string; tamper?: boolean } = {}) {
  const payload = JSON.stringify(body);
  const id = "msg_test";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bytes = Buffer.from((options.secret ?? SECRET).slice("whsec_".length), "base64");
  const signature = createHmac("sha256", bytes)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");
  return new Request("https://sme24.example/api/webhooks/resend", {
    method: "POST",
    body: options.tamper ? `${payload} ` : payload,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    },
  });
}

const delivered = {
  type: "email.delivered",
  created_at: "2026-09-05T10:00:00.000Z",
  data: { email_id: "email_1", from: "a", to: ["b"], subject: "s", created_at: "x" },
};

describe("handleResendWebhook", () => {
  beforeEach(() => {
    state.secret = SECRET;
    state.row = { id: "row_1", status: "sent" };
    state.updates = [];
  });

  it("answers 503 and logs when the secret is unset", async () => {
    state.secret = undefined;
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    const response = await handleResendWebhook(signedRequest(delivered));
    expect(response.status).toBe(503);
    expect(state.updates).toEqual([]);
  });

  it("answers 401 on a bad signature", async () => {
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    const response = await handleResendWebhook(signedRequest(delivered, { tamper: true }));
    expect(response.status).toBe(401);
    expect(state.updates).toEqual([]);
  });

  it("answers 200 for an unknown message id without writing", async () => {
    state.row = null;
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    const response = await handleResendWebhook(signedRequest(delivered));
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([]);
  });

  it("moves sent to delivered with the event time, guarded on the current status", async () => {
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    const response = await handleResendWebhook(signedRequest(delivered));
    expect(response.status).toBe(200);
    expect(state.updates).toEqual([
      {
        id: "row_1",
        status: "sent",
        patch: { status: "delivered", delivered_at: "2026-09-05T10:00:00.000Z" },
      },
    ]);
  });

  it("applies a delivery that lands before the task's sent write", async () => {
    state.row = { id: "row_1", status: "sending" };
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    await handleResendWebhook(signedRequest(delivered));
    expect(state.updates.map((update) => update.patch.status)).toEqual(["delivered"]);
  });

  it("ignores a bounce after a delivery (same rank) and a repeated delivered event", async () => {
    state.row = { id: "row_1", status: "delivered" };
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    const bounced = {
      ...delivered,
      type: "email.bounced",
      data: {
        ...delivered.data,
        bounce: { type: "Permanent", subType: "General", message: "nope" },
      },
    };
    await handleResendWebhook(signedRequest(bounced));
    await handleResendWebhook(signedRequest(delivered));
    expect(state.updates).toEqual([]);
  });

  it("records a bounce on a sent row with the bounce type and message", async () => {
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    const bounced = {
      ...delivered,
      type: "email.bounced",
      data: {
        ...delivered.data,
        bounce: { type: "Permanent", subType: "General", message: "nope" },
      },
    };
    await handleResendWebhook(signedRequest(bounced));
    expect(state.updates[0]?.patch).toEqual({ status: "bounced", error: "Permanent: nope" });
  });

  it("moves a delivered row to complained (higher rank) and only logs a delay", async () => {
    state.row = { id: "row_1", status: "delivered" };
    const { handleResendWebhook } = await import("@/lib/email/webhook");
    await handleResendWebhook(signedRequest({ ...delivered, type: "email.delivery_delayed" }));
    expect(state.updates).toEqual([]);
    await handleResendWebhook(signedRequest({ ...delivered, type: "email.complained" }));
    expect(state.updates.map((update) => update.patch.status)).toEqual(["complained"]);
  });
});
