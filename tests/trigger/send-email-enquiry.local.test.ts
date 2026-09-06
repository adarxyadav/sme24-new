// @vitest-environment node
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The enquiry acknowledgement against the real local stack (spec 0009, AC-14): the send-email
 * task takes the `enquiry_received` template for an outside address, writes the delivery row
 * with a null recipient and no notification, renders the German body naming the topic and the
 * reply time, and hands it to Mailpit over SMTP. Needs `supabase start` with `smtp_port`
 * exposed and a `.env.local`; skips otherwise (CI's check job has neither). Only the Trigger.dev
 * SDK is replaced, so `run` can be called directly.
 */
vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: unknown) => options,
  tasks: { onFailure: vi.fn() },
  logger: { debug: vi.fn(), log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/trigger/instrumentation", () => ({}));

const MAILPIT_URL = "http://127.0.0.1:54324";
const SMTP_PORT = 54325;
const ADDRESS = `enquiry-local-${Date.now().toString(36)}@example.test`;

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

describe.skipIf(!enabled)("send-email task with enquiry_received on the local stack", () => {
  const key = `enquiry/local-test-${Date.now()}/ack`;
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

  it("writes the delivery for the outside address, no notification, and sends the German acknowledgement to Mailpit", async () => {
    const payload = {
      kind: "new",
      template: "enquiry_received",
      data: { contactName: "Clara Muster", topic: "retainer" },
      recipient: { email: ADDRESS, locale: "de" },
      sourceEvent: "enquiry.received",
      idempotencyKey: key,
    };

    const result = await run(payload, { ctx });
    expect(result).toMatchObject({ status: "sent" });

    const { data: row } = await supabase
      .from("email_deliveries")
      .select("*")
      .eq("idempotency_key", key)
      .single();
    expect(row).toMatchObject({
      status: "sent",
      transport: "smtp",
      template: "enquiry_received",
      source_event: "enquiry.received",
      locale: "de",
      recipient_email: ADDRESS,
      recipient_id: null,
      organization_id: null,
      subject: "Ihre Anfrage ist bei SME24 eingegangen",
      data: { contactName: "Clara Muster", topic: "retainer" },
    });

    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("delivery_id", row?.id ?? "");
    expect(count).toBe(0);

    const mail = await waitForMail();
    expect(mail.Subject).toBe("Ihre Anfrage ist bei SME24 eingegangen");
    expect(mail.HTML).toContain("Guten Tag Clara Muster");
    expect(mail.HTML).toContain("Retainer-Anfrage");
    expect(mail.HTML).toContain("innerhalb eines Arbeitstags");
    expect(mail.HTML).toContain('href="http://localhost:3000/de"');
  });
});

type Summary = { ID: string };
type Message = { Subject: string; HTML: string };

async function waitForMail(): Promise<Message> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const url = new URL("/api/v1/search", MAILPIT_URL);
    url.searchParams.set("query", `to:"${ADDRESS}"`);
    const body = (await (await fetch(url)).json()) as { messages?: Summary[] };
    const newest = body.messages?.[0];
    if (newest) {
      const response = await fetch(new URL(`/api/v1/message/${newest.ID}`, MAILPIT_URL));
      return (await response.json()) as Message;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("no acknowledgement reached Mailpit");
}
