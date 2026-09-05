// @vitest-environment node
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The thin thread of spec 0006 against the real local stack (AC-1, AC-3, AC-4, AC-5): the task
 * writes the delivery and notification rows, renders the welcome email in the recipient's stored
 * language and hands it to Mailpit over SMTP; a second run with the same key reuses the row and
 * sends nothing. Needs `supabase start` with `smtp_port` exposed and a `.env.local`; skips
 * otherwise (CI's check job has neither). Only the Trigger.dev SDK is replaced, so `run` and the
 * hooks can be called directly.
 */
vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  tasks: { onFailure: vi.fn() },
  logger: { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));

const MAILPIT_URL = "http://127.0.0.1:54324";
const SMTP_PORT = 54325;
const CLIENT_USER_ID = "11111111-1111-4111-8111-111111111111";
const CLIENT_EMAIL = "client@example.com";

async function smtpReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: SMTP_PORT, timeout: 1_000 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const enabled = existsSync(".env.local") && (await smtpReachable());

describe.skipIf(!enabled)("send-email task on the local stack", () => {
  const key = `welcome/local-test-${Date.now()}`;
  const ctx = { run: { id: `run_local_${Date.now()}` }, attempt: { number: 1 } };
  let supabase: import("@supabase/supabase-js").SupabaseClient<
    import("@/lib/supabase/database.types").Database
  >;
  let run: (payload: unknown, options: { ctx: typeof ctx }) => Promise<unknown>;

  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    process.env.EMAIL_SMTP_URL ??= `smtp://127.0.0.1:${SMTP_PORT}`;
    const { taskEnv } = await import("@/lib/env");
    const { createServiceClient } = await import("@/lib/supabase/service");
    const env = taskEnv();
    supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    const task = (await import("@/trigger/send-email")).sendEmailTask as unknown as {
      run: typeof run;
    };
    run = task.run;
  });

  afterAll(async () => {
    await supabase.from("email_deliveries").delete().eq("idempotency_key", key);
  });

  it("writes the rows, sends the German welcome to Mailpit, and dedupes the second run", async () => {
    const before = await mailpitCount();
    const payload = {
      kind: "new",
      template: "welcome",
      data: { organizationName: "Musterfirma AG" },
      recipient: { userId: CLIENT_USER_ID },
      sourceEvent: "auth.organization_created",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      idempotencyKey: key,
    };

    const first = await run(payload, { ctx });
    expect(first).toMatchObject({ status: "sent" });

    const { data: row } = await supabase
      .from("email_deliveries")
      .select("*")
      .eq("idempotency_key", key)
      .single();
    expect(row).toMatchObject({
      status: "sent",
      transport: "smtp",
      attempts: 1,
      locale: "de",
      recipient_email: CLIENT_EMAIL,
      recipient_id: CLIENT_USER_ID,
      subject: "Willkommen bei SME24, Musterfirma AG",
      provider_message_id: null,
      last_run_id: ctx.run.id,
      data: { organizationName: "Musterfirma AG", firstName: "Clara" },
    });
    expect(row?.sent_at).not.toBeNull();

    const { data: notifications } = await supabase
      .from("notifications")
      .select("kind, link, delivery_id, recipient_id")
      .eq("delivery_id", row?.id ?? "");
    expect(notifications).toEqual([
      { kind: "welcome", link: "/app", delivery_id: row?.id, recipient_id: CLIENT_USER_ID },
    ]);

    const mail = await waitForMail(before + 1);
    expect(mail.Subject).toBe("Willkommen bei SME24, Musterfirma AG");
    expect(mail.HTML).toContain("Guten Tag Clara");
    expect(mail.HTML).toContain("Musterfirma AG");
    expect(mail.HTML).toContain("/de/app");

    // A second run of another trigger with the same key returns the row and sends nothing.
    const second = await run(payload, { ctx: { ...ctx, run: { id: `${ctx.run.id}_again` } } });
    expect(second).toEqual({ deliveryId: row?.id, status: "sent" });
    const { count } = await supabase
      .from("email_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("idempotency_key", key);
    expect(count).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await mailpitCount()).toBe(before + 1);
  });
});

type Summary = { ID: string; Subject: string };
type Message = { Subject: string; HTML: string };

async function search(): Promise<Summary[]> {
  const url = new URL("/api/v1/search", MAILPIT_URL);
  url.searchParams.set("query", `to:"${CLIENT_EMAIL}" subject:"Willkommen bei SME24"`);
  const response = await fetch(url);
  const body = (await response.json()) as { messages?: Summary[] };
  return body.messages ?? [];
}

async function mailpitCount(): Promise<number> {
  return (await search()).length;
}

async function waitForMail(expected: number): Promise<Message> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const messages = await search();
    const newest = messages[0];
    if (messages.length >= expected && newest) {
      const response = await fetch(new URL(`/api/v1/message/${newest.ID}`, MAILPIT_URL));
      return (await response.json()) as Message;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("no welcome email reached Mailpit");
}
