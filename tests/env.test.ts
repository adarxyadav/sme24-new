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
