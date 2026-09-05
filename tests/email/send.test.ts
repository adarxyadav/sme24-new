// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The request side triggers of the email rail (spec 0006, AC-1, AC-10, AC-15): `sendEmail` turns
 * the caller's key into a global Trigger.dev key with a 30 day TTL, `retryEmail` triggers with no
 * key at all, and neither ever throws: a missing `TRIGGER_SECRET_KEY` answers
 * `trigger_unavailable`, an unreachable Trigger.dev `trigger_failed`, logged and (only when
 * deployed) sent to Sentry with the organization id. The SDK, Sentry and the env are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  trigger: vi.fn<() => Promise<{ id: string }>>(),
  createKey: vi.fn(async (key: string, _options: unknown) => `global:${key}`),
  capture: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: boundary.trigger },
  idempotencyKeys: { create: boundary.createKey },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: boundary.capture }));
vi.mock("@/lib/env", () => ({ serverEnv: () => boundary.env }));

const { reportTriggerFailure, retryEmail, sendEmail } = await import("@/lib/email/send");

const ORG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const DELIVERY_ID = "d0000000-0000-4000-8000-000000000001";

const request = {
  template: "welcome" as const,
  data: { organizationName: "Musterfirma AG" },
  recipient: { userId: USER_ID },
  sourceEvent: "auth.organization_created",
  organizationId: ORG_ID,
  idempotencyKey: `welcome/${ORG_ID}`,
};

beforeEach(() => {
  boundary.env = { TRIGGER_SECRET_KEY: "tr_dev_test" };
  boundary.trigger.mockResolvedValue({ id: "run_1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sendEmail (AC-1, AC-15)", () => {
  it("triggers send-email with the new payload under a global 30 day idempotency key", async () => {
    await expect(sendEmail(request)).resolves.toEqual({ ok: true, runId: "run_1" });
    expect(boundary.createKey).toHaveBeenCalledWith(`welcome/${ORG_ID}`, { scope: "global" });
    expect(boundary.trigger).toHaveBeenCalledWith(
      "send-email",
      { kind: "new", ...request },
      { idempotencyKey: `global:welcome/${ORG_ID}`, idempotencyKeyTTL: "30d" },
    );
  });

  it("answers trigger_unavailable without calling the SDK when TRIGGER_SECRET_KEY is unset", async () => {
    boundary.env = {};
    await expect(sendEmail(request)).resolves.toEqual({ ok: false, error: "trigger_unavailable" });
    expect(boundary.trigger).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("answers trigger_failed and logs instead of throwing when Trigger.dev is unreachable", async () => {
    boundary.trigger.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(sendEmail(request)).resolves.toEqual({ ok: false, error: "trigger_failed" });
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("ECONNREFUSED");
    expect(boundary.capture).not.toHaveBeenCalled();
  });

  it("also answers trigger_failed when the idempotency key cannot be created", async () => {
    boundary.createKey.mockRejectedValueOnce(new Error("no api key"));
    await expect(sendEmail(request)).resolves.toEqual({ ok: false, error: "trigger_failed" });
    expect(boundary.trigger).not.toHaveBeenCalled();
  });

  it("reports a failed trigger to Sentry with the organization id only when deployed", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    boundary.trigger.mockRejectedValue(new Error("upstream down"));
    await sendEmail(request);
    expect(boundary.capture).toHaveBeenCalledWith(expect.any(Error), {
      tags: { source: "trigger", task: "send-email" },
      extra: { organizationId: ORG_ID },
    });
  });
});

describe("retryEmail (AC-10)", () => {
  it("triggers a retry payload with no Trigger.dev idempotency key", async () => {
    await expect(retryEmail(DELIVERY_ID)).resolves.toEqual({ ok: true, runId: "run_1" });
    expect(boundary.trigger).toHaveBeenCalledWith("send-email", {
      kind: "retry",
      deliveryId: DELIVERY_ID,
    });
    expect(boundary.createKey).not.toHaveBeenCalled();
  });

  it("answers trigger_unavailable without the secret and trigger_failed on a rejected trigger", async () => {
    boundary.env = {};
    await expect(retryEmail(DELIVERY_ID)).resolves.toEqual({
      ok: false,
      error: "trigger_unavailable",
    });
    boundary.env = { TRIGGER_SECRET_KEY: "tr_dev_test" };
    boundary.trigger.mockRejectedValue(new Error("timeout"));
    await expect(retryEmail(DELIVERY_ID)).resolves.toEqual({ ok: false, error: "trigger_failed" });
  });
});

describe("reportTriggerFailure (AC-15)", () => {
  it("logs a non Error reason as text and stays off Sentry locally", () => {
    reportTriggerFailure("ops-alert", "string reason", undefined);
    expect(String(vi.mocked(console.warn).mock.calls[0]?.[0])).toContain("string reason");
    expect(boundary.capture).not.toHaveBeenCalled();
  });
});
