import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientEnv, EnvError, resetEnvCache, serverEnv, taskEnv } from "@/lib/env";
import { publicEnv } from "@/lib/env.public";

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

  it("does not require RESEND_WEBHOOK_SECRET on a Vercel deployment (regression: PR #11 preview)", async () => {
    // `deployedOnVercel` is read when the module loads, so this case needs a fresh import with
    // VERCEL_ENV set and every variable that is genuinely required there present.
    stubAll({
      ...valid,
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o.ingest.de.sentry.io/1",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      TRIGGER_SECRET_KEY: "tr_test",
      AI_GATEWAY_API_KEY: "vck_test",
      SENTRY_DSN: "https://k@o.ingest.de.sentry.io/1",
      RESEND_WEBHOOK_SECRET: "",
    });
    vi.resetModules();
    const deployed = await import("@/lib/env");
    expect(() => deployed.serverEnv()).not.toThrow();
    expect(deployed.serverEnv().RESEND_WEBHOOK_SECRET).toBeUndefined();
    vi.resetModules();
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

describe("the research provider variables (spec 0007, AC-12, AC-16)", () => {
  it("falls to the fixture when no Parallel key is set and to Parallel when one is", () => {
    stubAll({ ...valid, PARALLEL_API_KEY: "", RESEARCH_PROVIDER: "" });
    expect(taskEnv().RESEARCH_PROVIDER).toBe("fixture");
    expect(taskEnv().PARALLEL_API_KEY).toBeUndefined();
    resetEnvCache();
    stubAll({ ...valid, PARALLEL_API_KEY: "pk_test", RESEARCH_PROVIDER: "" });
    expect(taskEnv().RESEARCH_PROVIDER).toBe("parallel");
  });

  it("lets an explicit fixture win over a key that is set", () => {
    stubAll({ ...valid, PARALLEL_API_KEY: "pk_test", RESEARCH_PROVIDER: "fixture" });
    expect(taskEnv().RESEARCH_PROVIDER).toBe("fixture");
  });

  it("rejects a provider it does not know, naming the variable", () => {
    stubAll({ ...valid, RESEARCH_PROVIDER: "google" });
    expect(() => taskEnv()).toThrowError(/RESEARCH_PROVIDER/);
  });

  it("stays on the task schema only: the server context ignores RESEARCH_PROVIDER", () => {
    stubAll({ ...valid, RESEARCH_PROVIDER: "google" });
    expect(() => serverEnv()).not.toThrow();
    expect("RESEARCH_PROVIDER" in serverEnv()).toBe(false);
  });

  it("requires the Parallel key on a deployed task unless the fixture is asked for explicitly", async () => {
    // `deployedTask` is read when the module loads, so each case needs a fresh import with
    // NODE_ENV production and every variable a deployed task genuinely needs.
    const deployed = {
      ...valid,
      NODE_ENV: "production",
      AI_GATEWAY_API_KEY: "vck_test",
      SENTRY_DSN: "https://k@o.ingest.de.sentry.io/1",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      EMAIL_FROM: "SME24 <no-reply@sme24.example>",
    };
    stubAll({ ...deployed, PARALLEL_API_KEY: "", RESEARCH_PROVIDER: "" });
    vi.resetModules();
    const bare = await import("@/lib/env");
    expect(() => bare.taskEnv()).toThrowError(/PARALLEL_API_KEY/);
    expect(() => bare.taskEnv()).toThrowError(/unless RESEARCH_PROVIDER is fixture/);

    stubAll({ ...deployed, PARALLEL_API_KEY: "", RESEARCH_PROVIDER: "fixture" });
    vi.resetModules();
    const fixture = await import("@/lib/env");
    expect(fixture.taskEnv().RESEARCH_PROVIDER).toBe("fixture");

    stubAll({ ...deployed, PARALLEL_API_KEY: "pk_live", RESEARCH_PROVIDER: "" });
    vi.resetModules();
    const keyed = await import("@/lib/env");
    expect(keyed.taskEnv().RESEARCH_PROVIDER).toBe("parallel");
    vi.resetModules();
  });
});

describe("publicEnv, the browser view without zod (spec 0009 amendment, AC-16)", () => {
  it("passes the six public values through, trimmed", () => {
    stubAll({
      ...valid,
      NEXT_PUBLIC_APP_URL: " https://sme24.ch ",
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o.ingest.de.sentry.io/1",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
    });
    expect(publicEnv()).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: valid.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: valid.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_APP_URL: "https://sme24.ch",
      NEXT_PUBLIC_SENTRY_DSN: "https://k@o.ingest.de.sentry.io/1",
      NEXT_PUBLIC_POSTHOG_KEY: "phc_test",
      NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.com",
    });
  });

  it("turns empty optional keys into undefined and defaults the PostHog host", () => {
    stubAll({
      ...valid,
      NEXT_PUBLIC_SENTRY_DSN: " ",
      NEXT_PUBLIC_POSTHOG_KEY: "",
      NEXT_PUBLIC_POSTHOG_HOST: "",
    });
    const env = publicEnv();
    expect(env.NEXT_PUBLIC_SENTRY_DSN).toBeUndefined();
    expect(env.NEXT_PUBLIC_POSTHOG_KEY).toBeUndefined();
    expect(env.NEXT_PUBLIC_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
  });

  it("never throws: a missing required value is an empty string, validated on the server instead", () => {
    stubAll({ ...valid, NEXT_PUBLIC_SUPABASE_URL: "" });
    expect(() => publicEnv()).not.toThrow();
    expect(publicEnv().NEXT_PUBLIC_SUPABASE_URL).toBe("");
    expect(() => clientEnv()).toThrowError(EnvError);
  });

  it("reads the same six keys the browser schema validates", () => {
    stubAll({ ...valid, NEXT_PUBLIC_SENTRY_DSN: "", NEXT_PUBLIC_POSTHOG_KEY: "" });
    expect(Object.keys(publicEnv()).sort()).toEqual(Object.keys(clientEnv()).sort());
  });

  it("imports no zod, so the browser bundle of a content page carries none", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/env.public.ts"), "utf8");
    expect(source).not.toMatch(/from "zod"/);
    expect(source).not.toMatch(/from "@\/lib\/env"/);
  });
});
