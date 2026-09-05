// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request side trigger of the alert rail (spec 0006, AC-2, AC-11): `sendOpsAlert` turns the
 * caller's key into a global Trigger.dev key with a 30 day TTL and never fails the caller. The
 * SDK, Sentry and the env are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  trigger: vi.fn<() => Promise<{ id: string }>>(),
  createKey: vi.fn(async (key: string, _options: unknown) => `global:${key}`),
}));

vi.mock("server-only", () => ({}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: boundary.trigger },
  idempotencyKeys: { create: boundary.createKey },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/env", () => ({ serverEnv: () => boundary.env }));

const { sendOpsAlert } = await import("@/lib/alerts/send");

const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const alert = {
  kind: "client.signed_up" as const,
  fields: { organizationName: "Musterfirma AG", userId: USER_ID },
  link: "/admin",
  idempotencyKey: `signup/${ORG_ID}`,
};

beforeEach(() => {
  boundary.env = { TRIGGER_SECRET_KEY: "tr_dev_test" };
  boundary.trigger.mockResolvedValue({ id: "run_9" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("sendOpsAlert (AC-2, AC-11)", () => {
  it("triggers ops-alert with the payload under a global 30 day idempotency key", async () => {
    await expect(sendOpsAlert(alert)).resolves.toEqual({ ok: true, runId: "run_9" });
    expect(boundary.createKey).toHaveBeenCalledWith(`signup/${ORG_ID}`, { scope: "global" });
    expect(boundary.trigger).toHaveBeenCalledWith("ops-alert", alert, {
      idempotencyKey: `global:signup/${ORG_ID}`,
      idempotencyKeyTTL: "30d",
    });
  });

  it("answers trigger_unavailable without the secret and never calls the SDK", async () => {
    boundary.env = {};
    await expect(sendOpsAlert(alert)).resolves.toEqual({
      ok: false,
      error: "trigger_unavailable",
    });
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("answers trigger_failed and logs when the trigger rejects, never throwing at the caller", async () => {
    boundary.trigger.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendOpsAlert(alert)).resolves.toEqual({ ok: false, error: "trigger_failed" });
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
