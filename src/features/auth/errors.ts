/**
 * Supabase Auth error codes mapped to `auth.errors` message keys (spec 0005, AC-12). Pure data and
 * functions; the actions and the route handlers call them. Codes the app must swallow so nothing
 * reveals whether an address is registered map to `null` ("treat as success").
 */

/** Keys of the `auth.errors` namespace an action may return. */
export const AUTH_ERROR_KEYS = [
  "invalidCredentials",
  "emailNotConfirmed",
  "rateLimited",
  "weakPassword",
  "samePassword",
  "codeInvalidOrExpired",
  "provider",
  "emailUnverified",
  "sessionMissing",
  "notAClient",
  "generic",
] as const;

export type AuthErrorKey = (typeof AUTH_ERROR_KEYS)[number];

/**
 * Codes that must look like success to the caller: a code request for an unknown email
 * (`otp_disabled`, because `shouldCreateUser` is false) and a sign up for an existing address.
 */
const SILENT_CODES: ReadonlySet<string> = new Set([
  "otp_disabled",
  "user_already_exists",
  "email_exists",
]);

const KNOWN_CODES: Readonly<Record<string, AuthErrorKey>> = {
  invalid_credentials: "invalidCredentials",
  email_not_confirmed: "emailNotConfirmed",
  over_email_send_rate_limit: "rateLimited",
  over_request_rate_limit: "rateLimited",
  over_sms_send_rate_limit: "rateLimited",
  weak_password: "weakPassword",
  same_password: "samePassword",
  // Supabase answers `otp_expired` ("Token has expired or is invalid") for a wrong six digit code
  // and for an expired one alike, so one combined message covers both (spec 0005, amendment of
  // 2026-09-05). An unusable token hash arrives as `validation_failed` with the same text.
  otp_expired: "codeInvalidOrExpired",
  validation_failed: "codeInvalidOrExpired",
  provider_disabled: "provider",
  provider_email_needs_verification: "emailUnverified",
  bad_oauth_state: "provider",
  bad_oauth_callback: "provider",
  oauth_provider_not_supported: "provider",
  flow_state_not_found: "provider",
  flow_state_expired: "provider",
  bad_code_verifier: "provider",
  session_not_found: "sessionMissing",
  session_expired: "sessionMissing",
  refresh_token_not_found: "sessionMissing",
  refresh_token_already_used: "sessionMissing",
  bad_jwt: "sessionMissing",
  reauthentication_needed: "sessionMissing",
  no_authorization: "sessionMissing",
  user_not_found: "sessionMissing",
};

/** True when Supabase's code is one the app answers with success on purpose (AC-12). Pure. */
export function isSilentAuthError(code: string | null | undefined): boolean {
  return typeof code === "string" && SILENT_CODES.has(code);
}

/** True when the code has a dedicated message; an unknown code gets `generic` and a Sentry event. Pure. */
export function isKnownAuthError(code: string | null | undefined): boolean {
  return typeof code === "string" && code in KNOWN_CODES;
}

/** The `auth.errors` key for a Supabase error code; `generic` when the code is unknown. Pure. */
export function authErrorKey(code: string | null | undefined): AuthErrorKey {
  if (typeof code !== "string") return "generic";
  return KNOWN_CODES[code] ?? "generic";
}
