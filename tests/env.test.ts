import { afterEach, describe, expect, it, vi } from "vitest";
import { clientEnv, EnvError, resetEnvCache, serverEnv, taskEnv } from "@/lib/env";

const valid = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  SUPABASE_SECRET_KEY: "sb_secret_test",
};

function stubAll(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value ?? "");
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("env module (AC-7)", () => {
  it("parses the browser variables", () => {
    stubAll(valid);
    const env = clientEnv();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe(valid.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.NEXT_PUBLIC_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
  });

  it("fails with a clear message naming the variable when a required one is missing", () => {
    stubAll({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "" });
    expect(() => clientEnv()).toThrowError(EnvError);
    expect(() => clientEnv()).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(() => clientEnv()).toThrowError(/browser environment/);
  });

  it("only the context that needs a variable fails on it", () => {
    stubAll({ ...valid, SUPABASE_SECRET_KEY: "" });
    expect(() => clientEnv()).not.toThrow();
    expect(() => serverEnv()).toThrowError(/SUPABASE_SECRET_KEY/);
    expect(() => taskEnv()).toThrowError(/task environment[\s\S]*SUPABASE_SECRET_KEY/);
  });

  it("treats empty optional keys as absent locally", () => {
    stubAll({ ...valid, SENTRY_DSN: "", NEXT_PUBLIC_POSTHOG_KEY: "" });
    expect(serverEnv().SENTRY_DSN).toBeUndefined();
    expect(taskEnv().NEXT_PUBLIC_POSTHOG_KEY).toBeUndefined();
  });
});

describe("the email rail variables (spec 0006, AC-5, AC-6)", () => {
  it("parses EMAIL_ALLOWED_RECIPIENTS into trimmed lowercase entries and drops empty ones", () => {
    stubAll({ ...valid, EMAIL_ALLOWED_RECIPIENTS: " Ops@SME24.ch, @Example.test ,, " });
    expect(taskEnv().EMAIL_ALLOWED_RECIPIENTS).toEqual(["ops@sme24.ch", "@example.test"]);
  });

  it("treats an empty or missing allowlist as no allowlist", () => {
    stubAll({ ...valid, EMAIL_ALLOWED_RECIPIENTS: " , " });
    expect(taskEnv().EMAIL_ALLOWED_RECIPIENTS).toBeUndefined();
    resetEnvCache();
    stubAll({ ...valid, EMAIL_ALLOWED_RECIPIENTS: undefined });
    expect(taskEnv().EMAIL_ALLOWED_RECIPIENTS).toBeUndefined();
  });

  it("keeps the transport, sender and webhook variables optional locally", () => {
    stubAll({
      ...valid,
      RESEND_API_KEY: "",
      EMAIL_FROM: "",
      EMAIL_REPLY_TO: "",
      EMAIL_SMTP_URL: "",
      RESEND_WEBHOOK_SECRET: "",
      OPS_ALERT_WEBHOOK_URL: "",
    });
    const task = taskEnv();
    expect(task.RESEND_API_KEY).toBeUndefined();
    expect(task.EMAIL_FROM).toBeUndefined();
    expect(task.EMAIL_SMTP_URL).toBeUndefined();
    expect(task.OPS_ALERT_WEBHOOK_URL).toBeUndefined();
    const server = serverEnv();
    expect(server.RESEND_WEBHOOK_SECRET).toBeUndefined();
    expect(server.OPS_ALERT_WEBHOOK_URL).toBeUndefined();
  });

  it("passes the values through when set", () => {
    stubAll({
      ...valid,
      EMAIL_SMTP_URL: "smtp://127.0.0.1:54325",
      EMAIL_FROM: "SME24 <no-reply@sme24.example>",
      OPS_ALERT_WEBHOOK_URL: "https://hooks.slack.example/services/T/B/x",
    });
    expect(taskEnv()).toMatchObject({
      EMAIL_SMTP_URL: "smtp://127.0.0.1:54325",
      EMAIL_FROM: "SME24 <no-reply@sme24.example>",
    });
    expect(serverEnv().OPS_ALERT_WEBHOOK_URL).toBe("https://hooks.slack.example/services/T/B/x");
  });
});
