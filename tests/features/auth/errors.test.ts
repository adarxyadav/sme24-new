import { describe, expect, it } from "vitest";
import {
  AUTH_ERROR_KEYS,
  authErrorKey,
  isKnownAuthError,
  isSilentAuthError,
} from "@/features/auth/errors";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

const deErrors = de.auth.errors as Record<string, string>;
const enErrors = en.auth.errors as Record<string, string>;

describe("auth error map (spec 0005, AC-12)", () => {
  it("maps a wrong and an expired six digit code to the one combined message (amendment 2026-09-05)", () => {
    // Supabase answers otp_expired for both, so the app cannot show two different messages.
    expect(authErrorKey("otp_expired")).toBe("codeInvalidOrExpired");
    expect(authErrorKey("validation_failed")).toBe("codeInvalidOrExpired");
  });

  it("no longer knows the separate codeInvalid and codeExpired keys", () => {
    expect(AUTH_ERROR_KEYS).not.toContain("codeInvalid");
    expect(AUTH_ERROR_KEYS).not.toContain("codeExpired");
    expect(deErrors).not.toHaveProperty("codeInvalid");
    expect(deErrors).not.toHaveProperty("codeExpired");
  });

  it("names both cases and the way out in each language", () => {
    expect(deErrors.codeInvalidOrExpired).toBe(
      "Der Code ist falsch oder abgelaufen. Fordern Sie einen neuen an.",
    );
    expect(enErrors.codeInvalidOrExpired).toBe(
      "The code is wrong or has expired. Request a new one.",
    );
  });

  it("has a message in both catalogs for every key an action may return", () => {
    for (const key of AUTH_ERROR_KEYS) {
      expect(deErrors[key], `de auth.errors.${key}`).toBeTruthy();
      expect(enErrors[key], `en auth.errors.${key}`).toBeTruthy();
    }
  });

  it("keeps the codes that must look like success silent, so nothing reveals a registered address", () => {
    for (const code of ["otp_disabled", "user_already_exists", "email_exists"]) {
      expect(isSilentAuthError(code)).toBe(true);
      expect(isKnownAuthError(code)).toBe(false);
    }
  });

  it("answers generic for an unknown, missing or malformed code", () => {
    expect(authErrorKey("something_new")).toBe("generic");
    expect(authErrorKey(null)).toBe("generic");
    expect(authErrorKey(undefined)).toBe("generic");
    expect(isKnownAuthError("something_new")).toBe(false);
    expect(isSilentAuthError(undefined)).toBe(false);
  });

  it("keeps the credential and session codes on their own messages", () => {
    expect(authErrorKey("invalid_credentials")).toBe("invalidCredentials");
    expect(authErrorKey("email_not_confirmed")).toBe("emailNotConfirmed");
    expect(authErrorKey("over_email_send_rate_limit")).toBe("rateLimited");
    expect(authErrorKey("weak_password")).toBe("weakPassword");
    expect(authErrorKey("same_password")).toBe("samePassword");
    expect(authErrorKey("refresh_token_already_used")).toBe("sessionMissing");
    expect(authErrorKey("bad_code_verifier")).toBe("provider");
  });
});
