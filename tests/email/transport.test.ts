// @vitest-environment node
import { describe, expect, it } from "vitest";
import { chooseTransport, classifyHttpFailure, isAllowedRecipient } from "@/lib/email/transport";

/** Transport choice, the allowlist and the retry classes (spec 0006, AC-5, AC-6, AC-7). Pure functions. */
describe("chooseTransport", () => {
  it("prefers Resend, then SMTP, else none", () => {
    expect(chooseTransport({ RESEND_API_KEY: "re_x", EMAIL_SMTP_URL: "smtp://l" })).toBe("resend");
    expect(chooseTransport({ EMAIL_SMTP_URL: "smtp://127.0.0.1:54325" })).toBe("smtp");
    expect(chooseTransport({})).toBeNull();
  });
});

describe("isAllowedRecipient", () => {
  it("allows everyone without an allowlist", () => {
    expect(isAllowedRecipient("anyone@example.com", undefined)).toBe(true);
    expect(isAllowedRecipient("anyone@example.com", [])).toBe(true);
  });

  it("matches an address or an @domain entry, case insensitive", () => {
    const allowlist = ["ops@sme24.ch", "@example.test"];
    expect(isAllowedRecipient("Ops@SME24.ch", allowlist)).toBe(true);
    expect(isAllowedRecipient("someone@Example.test", allowlist)).toBe(true);
    expect(isAllowedRecipient("someone@sme24.ch", allowlist)).toBe(false);
    expect(isAllowedRecipient("someone@notexample.test", allowlist)).toBe(false);
  });
});

describe("classifyHttpFailure", () => {
  it("retries on 429, 5xx and network errors, fails at once on other 4xx", () => {
    expect(classifyHttpFailure(429)).toBe("transient");
    expect(classifyHttpFailure(500)).toBe("transient");
    expect(classifyHttpFailure(503)).toBe("transient");
    expect(classifyHttpFailure(null)).toBe("transient");
    expect(classifyHttpFailure(422)).toBe("permanent");
    expect(classifyHttpFailure(403)).toBe("permanent");
    expect(classifyHttpFailure(400)).toBe("permanent");
  });
});
