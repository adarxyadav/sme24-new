import { IntlError, IntlErrorCode } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sentry = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/node", () => ({ captureException: sentry.captureException }));

const { getMessageFallback, onError, resetReportedKeys } = await import("@/i18n/on-error");

describe("next-intl error handling (spec 0004, AC-12)", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    resetReportedKeys();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", originalEnv ?? "test");
    vi.restoreAllMocks();
  });

  it("throws on a missing message in test and development", () => {
    const error = new IntlError(IntlErrorCode.MISSING_MESSAGE, "Could not resolve `nav.nope`");
    expect(() => onError(error)).toThrow(error);
    vi.stubEnv("NODE_ENV", "development");
    expect(() => onError(error)).toThrow(error);
    expect(sentry.captureException).not.toHaveBeenCalled();
  });

  it("reports a missing message to Sentry once per key in production and never throws", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = new IntlError(IntlErrorCode.MISSING_MESSAGE, "Could not resolve `nav.nope`");
    expect(() => onError(error)).not.toThrow();
    expect(() => onError(error)).not.toThrow();
    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(sentry.captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        fingerprint: ["intl", "MISSING_MESSAGE", error.message],
      }),
    );

    const other = new IntlError(IntlErrorCode.MISSING_MESSAGE, "Could not resolve `nav.other`");
    onError(other);
    expect(sentry.captureException).toHaveBeenCalledTimes(2);
  });

  it("logs other error codes as a warning without reporting them", () => {
    vi.stubEnv("NODE_ENV", "production");
    onError(new IntlError(IntlErrorCode.FORMATTING_ERROR, "bad format"));
    expect(sentry.captureException).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the key path so the page renders", () => {
    expect(getMessageFallback({ namespace: "nav", key: "nope" })).toBe("nav.nope");
    expect(getMessageFallback({ key: "nope" })).toBe("nope");
  });
});
