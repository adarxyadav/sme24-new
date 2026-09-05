import { IntlError, IntlErrorCode } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnError, getMessageFallback, messageKey, resetReportedKeys } from "@/i18n/on-error";

describe("next-intl error handling (spec 0004, AC-12)", () => {
  const originalEnv = process.env.NODE_ENV;
  const captureException = vi.fn();
  const onError = createOnError(captureException);

  beforeEach(() => {
    resetReportedKeys();
    captureException.mockReset();
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
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports a missing message to the injected Sentry client once per key in production and never throws", () => {
    vi.stubEnv("NODE_ENV", "production");
    const error = new IntlError(
      IntlErrorCode.MISSING_MESSAGE,
      "Could not resolve `nav.nope` in messages for locale `de-CH`.",
    );
    expect(() => onError(error)).not.toThrow();
    expect(() => onError(error)).not.toThrow();
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      error,
      expect.objectContaining({
        fingerprint: ["intl", "MISSING_MESSAGE", "nav.nope"],
        tags: { source: "next-intl", code: "MISSING_MESSAGE" },
      }),
    );

    const other = new IntlError(IntlErrorCode.MISSING_MESSAGE, "Could not resolve `nav.other`");
    onError(other);
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it("counts one key missing in both locales as one report", () => {
    vi.stubEnv("NODE_ENV", "production");
    onError(
      new IntlError(
        IntlErrorCode.MISSING_MESSAGE,
        "Could not resolve `nav.nope` in messages for locale `de-CH`.",
      ),
    );
    onError(
      new IntlError(
        IntlErrorCode.MISSING_MESSAGE,
        "Could not resolve `nav.nope` in messages for locale `en-CH`.",
      ),
    );
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("keys an invalid message on its path, not on the offending ICU fragment", () => {
    const withFragment = new IntlError(
      IntlErrorCode.INVALID_MESSAGE,
      "Invalid message `nav.bad` (MALFORMED_ARGUMENT at position 3: {count, plural})",
    );
    expect(messageKey(withFragment)).toBe("nav.bad");
    const bare = new IntlError(IntlErrorCode.INVALID_MESSAGE, "no key quoted");
    expect(messageKey(bare)).toBe(bare.message);
  });

  it("logs other error codes as a warning without reporting them", () => {
    vi.stubEnv("NODE_ENV", "production");
    onError(new IntlError(IntlErrorCode.FORMATTING_ERROR, "bad format"));
    expect(captureException).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("falls back to the key path so the page renders", () => {
    expect(getMessageFallback({ namespace: "nav", key: "nope" })).toBe("nav.nope");
    expect(getMessageFallback({ key: "nope" })).toBe("nope");
  });
});
