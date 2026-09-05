// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The send-email task against fakes (spec 0006, AC-4, AC-6, AC-7): a permanent provider error
 * marks the row failed at once and raises the `email.failed` alert, a transient error throws so
 * Trigger.dev retries, the allowlist skips without a transport call and still writes the
 * notification, invalid data fails without a send, and a retry reuses the stored address. The
 * SDK, the env, the service client and both transports are the boundaries.
 */
const state = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  rows: new Map<string, Record<string, unknown>>(),
  notifications: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  resend: null as null | Record<string, unknown>,
  smtp: null as null | Record<string, unknown>,
  sent: [] as Array<{ transport: string; message: Record<string, unknown> }>,
  alerts: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  tasks: { onFailure: vi.fn() },
  idempotencyKeys: { create: async (key: string) => key },
  AbortTaskRunError: class extends Error {},
  logger: { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/trigger/ops-alert", () => ({
  raiseAlertFromTask: async (alert: Record<string, unknown>) => {
    state.alerts.push(alert);
  },
}));
vi.mock("@/lib/env", () => ({ taskEnv: () => state.env }));
vi.mock("@/lib/email/transport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/transport")>();
  return {
    ...actual,
    sendViaResend: async (_key: string, message: Record<string, unknown>) => {
      state.sent.push({ transport: "resend", message });
      return state.resend;
    },
    sendViaSmtp: async (_url: string, message: Record<string, unknown>) => {
      state.sent.push({ transport: "smtp", message });
      return state.smtp;
    },
  };
});
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => fakeSupabase() }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function fakeSupabase() {
  const deliveries = {
    select: () => ({
      eq: (column: string, value: string) => ({
        maybeSingle: async () => {
          const row = [...state.rows.values()].find((candidate) => candidate[column] === value);
          return { data: row ?? null, error: null };
        },
      }),
    }),
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          const id = `d0000000-0000-4000-8000-00000000000${state.nextId++}`;
          const stored = {
            id,
            attempts: 0,
            last_run_id: null,
            subject: null,
            transport: null,
            provider_message_id: null,
            error: null,
            sent_at: null,
            delivered_at: null,
            failed_at: null,
            created_at: "2026-09-05T10:00:00.000Z",
            updated_at: "2026-09-05T10:00:00.000Z",
            ...row,
          };
          state.rows.set(id, stored);
          return { data: stored, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => {
      const apply = (id: string) => {
        state.updates.push({ id, patch });
        const row = state.rows.get(id);
        if (row) state.rows.set(id, { ...row, ...patch });
        return { error: null };
      };
      return {
        eq: (_column: string, id: string) => {
          const chain = {
            not: async () => apply(id),
            in: async () => apply(id),
            // biome-ignore lint/suspicious/noThenProperty: mimics the awaitable Supabase query builder
            then: (resolve: (value: { error: null }) => void) => resolve(apply(id)),
          };
          return chain;
        },
      };
    },
  };
  return {
    from: (table: string) => {
      if (table === "email_deliveries") return deliveries;
      if (table === "notifications") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.notifications.push(row);
            return { error: null };
          },
        };
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { locale: "de", full_name: "Clara Client" },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: async () => ({
          data: { user: { email: "clara@example.test" } },
          error: null,
        }),
      },
    },
  };
}

async function loadTask() {
  const { sendEmailTask } = await import("@/trigger/send-email");
  return sendEmailTask as unknown as {
    run: (payload: unknown, options: { ctx: unknown }) => Promise<{ status: string }>;
    onFailure: (params: { payload: unknown; ctx: unknown; error: unknown }) => Promise<void>;
  };
}

const ctx = { run: { id: "run_1" }, attempt: { number: 1 } };
const newPayload = {
  kind: "new",
  template: "welcome",
  data: { organizationName: "Musterfirma AG" },
  recipient: { userId: USER_ID },
  sourceEvent: "auth.organization_created",
  organizationId: ORG_ID,
  idempotencyKey: `welcome/${ORG_ID}`,
};

describe("send-email task", () => {
  beforeEach(() => {
    state.env = {
      SUPABASE_SECRET_KEY: "k",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_APP_URL: "https://sme24.example",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "SME24 <no-reply@sme24.example>",
      EMAIL_REPLY_TO: "ops@sme24.example",
    };
    state.rows.clear();
    state.notifications = [];
    state.updates = [];
    state.sent = [];
    state.alerts = [];
    state.resend = { ok: true, providerMessageId: "msg_1" };
    state.smtp = { ok: true, providerMessageId: null };
    state.nextId = 1;
  });

  it("sends through Resend with the idempotency key, the tag data, from and reply to (AC-5)", async () => {
    const task = await loadTask();
    const result = await task.run(newPayload, { ctx });
    expect(result.status).toBe("sent");
    const [sent] = state.sent;
    expect(sent?.transport).toBe("resend");
    expect(sent?.message).toMatchObject({
      from: "SME24 <no-reply@sme24.example>",
      replyTo: "ops@sme24.example",
      to: "clara@example.test",
      subject: "Willkommen bei SME24, Musterfirma AG",
      idempotencyKey: "d0000000-0000-4000-8000-000000000001/1",
      template: "welcome",
    });
    const row = state.rows.get("d0000000-0000-4000-8000-000000000001");
    expect(row).toMatchObject({
      status: "sent",
      provider_message_id: "msg_1",
      attempts: 1,
      last_run_id: "run_1",
      transport: "resend",
      data: { organizationName: "Musterfirma AG", firstName: "Clara" },
    });
    expect(state.notifications).toEqual([
      expect.objectContaining({ recipient_id: USER_ID, kind: "welcome", link: "/app" }),
    ]);
  });

  it("marks a 4xx failure failed at once and raises the email.failed alert (AC-7)", async () => {
    state.resend = { ok: false, kind: "permanent", message: "domain not verified", status: 422 };
    const task = await loadTask();
    const result = await task.run(newPayload, { ctx });
    expect(result.status).toBe("failed");
    expect(state.rows.get("d0000000-0000-4000-8000-000000000001")).toMatchObject({
      status: "failed",
      error: "domain not verified",
    });
    expect(state.alerts).toEqual([
      expect.objectContaining({
        kind: "email.failed",
        link: "/admin/emails/d0000000-0000-4000-8000-000000000001",
        idempotencyKey: "email-failed/d0000000-0000-4000-8000-000000000001/1",
      }),
    ]);
  });

  it("throws on a 5xx so Trigger.dev retries, and onFailure records the last failure (AC-7)", async () => {
    state.resend = { ok: false, kind: "transient", message: "upstream down", status: 503 };
    const task = await loadTask();
    await expect(task.run(newPayload, { ctx })).rejects.toThrow("upstream down");
    expect(state.rows.get("d0000000-0000-4000-8000-000000000001")?.status).toBe("sending");
    expect(state.alerts).toEqual([]);

    await task.onFailure({ payload: newPayload, ctx, error: new Error("upstream down") });
    expect(state.rows.get("d0000000-0000-4000-8000-000000000001")).toMatchObject({
      status: "failed",
      error: "upstream down",
    });
    expect(state.alerts.map((alert) => alert.kind)).toEqual(["email.failed"]);
  });

  it("skips a recipient outside the allowlist, calls no transport and still notifies (AC-6)", async () => {
    state.env.EMAIL_ALLOWED_RECIPIENTS = ["@sme24.example"];
    const task = await loadTask();
    const result = await task.run(newPayload, { ctx });
    expect(result.status).toBe("skipped");
    expect(state.sent).toEqual([]);
    expect(state.alerts).toEqual([]);
    expect(state.rows.get("d0000000-0000-4000-8000-000000000001")?.error).toBe("not_allowlisted");
    expect(state.notifications).toHaveLength(1);
  });

  it("skips with no_transport when neither Resend nor SMTP is configured (AC-5)", async () => {
    state.env.RESEND_API_KEY = undefined;
    const task = await loadTask();
    const result = await task.run(newPayload, { ctx });
    expect(result.status).toBe("skipped");
    expect(state.rows.get("d0000000-0000-4000-8000-000000000001")?.error).toBe("no_transport");
  });

  it("fails invalid data without sending and writes no notification for ops events (AC-3, AC-4)", async () => {
    const task = await loadTask();
    const result = await task.run(
      { ...newPayload, data: {}, sourceEvent: "ops.test_email", idempotencyKey: "ops/1" },
      { ctx },
    );
    expect(result.status).toBe("failed");
    expect(state.sent).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(String(state.rows.get("d0000000-0000-4000-8000-000000000001")?.error)).toMatch(
      /^invalid_data: organizationName/,
    );
  });

  it("returns the existing row for a second trigger with the same key (AC-4)", async () => {
    const task = await loadTask();
    await task.run(newPayload, { ctx });
    const again = await task.run(newPayload, { ctx: { ...ctx, run: { id: "run_2" } } });
    expect(again).toEqual({ deliveryId: "d0000000-0000-4000-8000-000000000001", status: "sent" });
    expect(state.sent).toHaveLength(1);
  });

  it("retries a failed row from the stored address and language over SMTP (AC-4, AC-10)", async () => {
    state.env.RESEND_API_KEY = undefined;
    state.env.EMAIL_SMTP_URL = "smtp://127.0.0.1:54325";
    state.env.EMAIL_FROM = undefined;
    state.rows.set("d0000000-0000-4000-8000-000000000009", {
      id: "d0000000-0000-4000-8000-000000000009",
      idempotency_key: "welcome/x",
      template: "welcome",
      locale: "en",
      recipient_email: "stored@example.test",
      recipient_id: USER_ID,
      data: { organizationName: "Stored Ltd" },
      status: "failed",
      attempts: 1,
      error: "boom",
    });
    const task = await loadTask();
    const result = await task.run(
      { kind: "retry", deliveryId: "d0000000-0000-4000-8000-000000000009" },
      { ctx },
    );
    expect(result.status).toBe("sent");
    expect(state.sent[0]).toMatchObject({
      transport: "smtp",
      message: {
        to: "stored@example.test",
        from: "SME24 <no-reply@sme24.local>",
        subject: "Welcome to SME24, Stored Ltd",
        idempotencyKey: "d0000000-0000-4000-8000-000000000009/2",
      },
    });
    expect(state.rows.get("d0000000-0000-4000-8000-000000000009")).toMatchObject({
      status: "sent",
      attempts: 2,
      provider_message_id: null,
      error: null,
    });
  });
});
