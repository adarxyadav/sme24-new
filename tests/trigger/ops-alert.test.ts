// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ops-alert task (spec 0006, AC-2, AC-11): an unset webhook logs and returns `posted: false`,
 * a sign up resolves the person's name and language from the user id (never their address),
 * the Block Kit body carries the Swiss formatted time and a `/de/admin` button, a 429 or 5xx
 * throws so Trigger.dev retries, another 4xx aborts, and `raiseAlertFromTask` never fails the
 * calling task. The SDK, the env, the service client and `fetch` are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  profile: null as { locale: string | null; full_name: string | null } | null,
  profileError: null as unknown,
  profileReads: [] as string[],
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
  trigger: vi.fn<() => Promise<{ id: string }>>(),
  createKey: vi.fn(async (key: string, _options: unknown) => `global:${key}`),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@trigger.dev/sdk", () => ({
  schemaTask: (options: Record<string, unknown>) => ({ ...options, trigger: boundary.trigger }),
  idempotencyKeys: { create: boundary.createKey },
  AbortTaskRunError: class AbortTaskRunError extends Error {},
  logger: {
    debug: vi.fn(),
    log: vi.fn(),
    info: boundary.info,
    warn: boundary.warn,
    error: vi.fn(),
  },
}));
vi.mock("@/trigger/instrumentation", () => ({}));
vi.mock("@/lib/env", () => ({ taskEnv: () => boundary.env }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: (columns: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              boundary.profileReads.push(columns);
              return { data: boundary.profile, error: boundary.profileError };
            },
          }),
        }),
      };
    },
  }),
}));

const { AbortTaskRunError } = await import("@trigger.dev/sdk");
const { opsAlertTask, raiseAlertFromTask } = await import("@/trigger/ops-alert");
const run = (opsAlertTask as unknown as { run: (payload: unknown) => Promise<{ posted: boolean }> })
  .run;

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WEBHOOK = "https://hooks.slack.example/services/T/B/x";
const AT = new Date("2026-09-05T10:00:00Z");

const testAlert = {
  kind: "ops.test" as const,
  fields: { triggeredBy: "Olga Ops" },
  link: "/admin/emails",
  idempotencyKey: "ops-test/1",
};
const signUp = {
  kind: "client.signed_up" as const,
  fields: { organizationName: "Musterfirma AG", userId: USER_ID },
  link: "/admin",
  idempotencyKey: "signup/org",
};

function answer(status: number, body = "") {
  return new Response(body, { status });
}

function postedBody() {
  const init = boundary.fetch.mock.calls[0]?.[1];
  return JSON.parse(String(init?.body)) as {
    text: string;
    blocks: Array<Record<string, unknown>>;
  };
}

beforeEach(() => {
  boundary.env = {
    OPS_ALERT_WEBHOOK_URL: WEBHOOK,
    NEXT_PUBLIC_APP_URL: "https://sme24.example/",
    SUPABASE_SECRET_KEY: "k",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };
  boundary.profile = { locale: "de", full_name: "Clara Client" };
  boundary.profileError = null;
  boundary.profileReads = [];
  boundary.fetch.mockResolvedValue(answer(200, "ok"));
  boundary.trigger.mockResolvedValue({ id: "run_alert" });
  vi.stubGlobal("fetch", boundary.fetch);
  vi.useFakeTimers({ now: AT, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ops-alert task (AC-2, AC-11)", () => {
  it("logs the alert as skipped and does not fail when the webhook is unset", async () => {
    boundary.env.OPS_ALERT_WEBHOOK_URL = undefined;
    await expect(run(testAlert)).resolves.toEqual({ posted: false });
    expect(boundary.fetch).not.toHaveBeenCalled();
    expect(boundary.warn).toHaveBeenCalledWith(
      expect.stringContaining("skipped"),
      expect.objectContaining({ kind: "ops.test" }),
    );
  });

  it("posts Block Kit as JSON to the webhook with a header, the fields and a /de button", async () => {
    await expect(run(testAlert)).resolves.toEqual({ posted: true });
    const [url, init] = boundary.fetch.mock.calls[0] ?? [];
    expect(url).toBe(WEBHOOK);
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" } });
    const body = postedBody();
    expect(body.text).toBe("Test alert: Olga Ops");
    expect(body.blocks[0]).toEqual({
      type: "header",
      text: { type: "plain_text", text: "Test alert", emoji: false },
    });
    expect(body.blocks[1]).toMatchObject({
      fields: [
        { type: "mrkdwn", text: "*Triggered by*\nOlga Ops" },
        { type: "mrkdwn", text: "*Time*\n05.09.2026, 12:00" },
      ],
    });
    expect(body.blocks[2]).toMatchObject({
      elements: [{ type: "button", url: "https://sme24.example/de/admin/emails" }],
    });
    expect(boundary.profileReads).toEqual([]);
  });

  it("resolves the person behind a sign up from the user id and never posts an email address", async () => {
    await run(signUp);
    expect(boundary.profileReads.sort()).toEqual(["full_name", "locale"]);
    const body = postedBody();
    expect(body.text).toBe("New client signed up: Musterfirma AG");
    expect(body.blocks[1]).toMatchObject({
      fields: [
        { text: "*Organization*\nMusterfirma AG" },
        { text: "*Name*\nClara Client" },
        { text: "*Language*\nGerman" },
        { text: "*Time*\n05.09.2026, 12:00" },
      ],
    });
    expect(body.blocks[2]).toMatchObject({
      elements: [{ url: "https://sme24.example/de/admin" }],
    });
    expect(JSON.stringify(body)).not.toContain("@");
  });

  it("shows Unknown for a sign up whose profile is gone instead of failing", async () => {
    boundary.profile = null;
    await run(signUp);
    expect(postedBody().blocks[1]).toMatchObject({
      fields: expect.arrayContaining([{ type: "mrkdwn", text: "*Name*\nUnknown" }]),
    });
  });

  it("throws on a profile lookup error so the run retries", async () => {
    boundary.profileError = new Error("connection reset");
    await expect(run(signUp)).rejects.toThrow("connection reset");
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])("throws a retryable error on a %s answer", async (status) => {
    boundary.fetch.mockResolvedValue(answer(status, "slow down"));
    const failure = await run(testAlert).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(AbortTaskRunError);
    expect(String(failure)).toContain(String(status));
    expect(String(failure)).toContain("slow down");
  });

  it.each([400, 403, 404])("aborts without a retry on a %s answer", async (status) => {
    boundary.fetch.mockResolvedValue(answer(status, "no_service"));
    await expect(run(testAlert)).rejects.toBeInstanceOf(AbortTaskRunError);
  });
});

describe("raiseAlertFromTask (AC-7, AC-11)", () => {
  it("triggers the task under a global idempotency key", async () => {
    await raiseAlertFromTask(testAlert);
    expect(boundary.createKey).toHaveBeenCalledWith("ops-test/1", { scope: "global" });
    expect(boundary.trigger).toHaveBeenCalledWith(testAlert, {
      idempotencyKey: "global:ops-test/1",
    });
  });

  it("logs and swallows a failed trigger so the calling task never fails on its alert", async () => {
    boundary.trigger.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(raiseAlertFromTask(testAlert)).resolves.toBeUndefined();
    expect(boundary.warn).toHaveBeenCalledWith(
      "ops alert trigger failed",
      expect.objectContaining({
        kind: "ops.test",
        reason: expect.stringContaining("ECONNREFUSED"),
      }),
    );
  });
});
