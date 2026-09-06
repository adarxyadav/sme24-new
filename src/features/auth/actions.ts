"use server";

import * as Sentry from "@sentry/nextjs";
import type { AuthError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { LOCALE_CODE, type Locale, resolveLocale } from "@/i18n/routing";
import { landingPath, localizedPath, nextWithinLocale, roleHomePath } from "@/lib/auth/redirects";
import { roleFromClaims } from "@/lib/auth/roles";
import { clientEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { parseWith } from "@/lib/validation";
import { type AuthErrorKey, authErrorKey, isKnownAuthError, isSilentAuthError } from "./errors";
import {
  emailRequestSchema,
  onboardingSchema,
  requestCodeSchema,
  signInSchema,
  signInWithProviderSchema,
  signOutSchema,
  signUpSchema,
  updatePasswordSchema,
  verifyCodeSchema,
} from "./schema";
import { confirmRedirectUrl, ensureOrganization, finalizeSignIn } from "./session";

/**
 * The auth server actions (spec 0005). Every action parses its input with the feature's schema,
 * returns `{ ok: true, data }` or `{ ok: false, error }` for expected failures and redirects on a
 * successful sign in. Actions that send an email answer success whether or not the address exists
 * (AC-12). Unknown Supabase codes get the generic message and a Sentry event.
 */

export type AuthActionError = AuthErrorKey | "invalidInput";
export type AuthResult<Data = undefined> =
  | { ok: true; data: Data }
  | { ok: false; error: AuthActionError };

/** The locale the caller's page runs in; the default when the payload has none. */
function localeOf(input: unknown): Locale {
  return resolveLocale((input as { locale?: unknown } | null)?.locale);
}

/**
 * Turns a Supabase error into the action's answer: swallowed codes look like success (AC-12),
 * known codes map to their message, unknown codes go to Sentry and show the generic message.
 * `silent: false` (a code check, where no swallowed code applies) always answers with a message.
 */
function failure(error: AuthError, action: string, options: { silent: false }): AuthResult<never>;
function failure(
  error: AuthError,
  action: string,
  options?: { silent?: true },
): AuthResult<never> | { ok: true; data: undefined };
function failure(
  error: AuthError,
  action: string,
  { silent = true }: { silent?: boolean } = {},
): AuthResult<never> | { ok: true; data: undefined } {
  const code = error.code ?? null;
  log.info(`${action} rejected`, { reason: code ?? error.message });
  if (silent && isSilentAuthError(code)) return { ok: true, data: undefined };
  if (!isKnownAuthError(code)) {
    Sentry.captureException(error, { tags: { source: `auth-${action}` } });
  }
  return { ok: false, error: authErrorKey(code) };
}

/** The user metadata a public sign up carries (value sourcing: name, company, locale, consent). */
function signUpMetadata(
  values: { fullName: string; organizationName: string; termsAccepted: boolean },
  locale: Locale,
) {
  return {
    full_name: values.fullName,
    organization_name: values.organizationName,
    locale: LOCALE_CODE[locale],
    // The schema only accepts `true`; the timestamp is the consent record the trigger copies.
    terms_accepted_at: values.termsAccepted ? new Date().toISOString() : undefined,
  };
}

/**
 * Password sign up (AC-1, AC-11): creates the unconfirmed account with the sign up metadata and
 * lets Supabase send the confirmation email. Answers success for an existing address too. Server
 * action, anonymous.
 */
export async function signUp(
  _previous: AuthResult<{ email: string }> | null,
  input: unknown,
): Promise<AuthResult<{ email: string }>> {
  const locale = localeOf(input);
  const parsed = parseWith(signUpSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { email, password } = parsed.data;

  const supabase = await createActionClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmRedirectUrl(locale, "/app"),
      data: signUpMetadata(parsed.data, locale),
    },
  });
  if (error) {
    const result = failure(error, "sign-up");
    return result.ok ? { ok: true, data: { email } } : result;
  }
  return { ok: true, data: { email } };
}

/**
 * Sends a six digit code (AC-2, AC-4): on `sign-up` it creates the account with the sign up
 * metadata, on `sign-in` it never creates one, and an unknown address answers success. Server
 * action, anonymous.
 */
export async function requestCode(
  _previous: AuthResult<{ email: string }> | null,
  input: unknown,
): Promise<AuthResult<{ email: string }>> {
  const locale = localeOf(input);
  const parsed = parseWith(requestCodeSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const values = parsed.data;

  const supabase = await createActionClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: values.email,
    options:
      values.purpose === "sign-up"
        ? {
            shouldCreateUser: true,
            emailRedirectTo: confirmRedirectUrl(locale, "/app"),
            data: signUpMetadata(values, locale),
          }
        : { shouldCreateUser: false, emailRedirectTo: confirmRedirectUrl(locale, "/app") },
  });
  if (error) {
    const result = failure(error, "request-code");
    return result.ok ? { ok: true, data: { email: values.email } } : result;
  }
  return { ok: true, data: { email: values.email } };
}

/**
 * Verifies a six digit code and signs the user in (AC-2, AC-4), then lands them through
 * `finalizeSignIn`. A wrong or expired code returns one combined message, because Supabase does
 * not tell the two apart. Server action, anonymous.
 */
export async function verifyCode(
  _previous: AuthResult | null,
  input: unknown,
): Promise<AuthResult> {
  const locale = localeOf(input);
  const parsed = parseWith(verifyCodeSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createActionClient();
  const { error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "email",
  });
  if (error) return failure(error, "verify-code", { silent: false });

  redirect(await finalizeSignIn(supabase, locale, parsed.data.next));
}

/**
 * Password sign in (AC-3, AC-12): a wrong email or password gets one generic message, an
 * unconfirmed account gets the resend offer, a success lands through `finalizeSignIn`. Server
 * action, anonymous.
 */
export async function signIn(_previous: AuthResult | null, input: unknown): Promise<AuthResult> {
  const locale = localeOf(input);
  const parsed = parseWith(signInSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidCredentials" };

  const supabase = await createActionClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    const result = failure(error, "sign-in");
    return result.ok ? { ok: false, error: "invalidCredentials" } : result;
  }

  redirect(await finalizeSignIn(supabase, locale, parsed.data.next));
}

/**
 * Starts a Google or Microsoft sign in (AC-5): the PKCE verifier cookie lands on this action's
 * response and the provider returns to `/api/auth/callback`. Server action, anonymous.
 */
export async function signInWithProvider(
  _previous: AuthResult | null,
  input: unknown,
): Promise<AuthResult> {
  const locale = localeOf(input);
  const parsed = parseWith(signInWithProviderSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  // The locale travels on its own parameter; `next` only when the user asked for one, so
  // `finalizeSignIn` falls through to the role home for staff (AC-5).
  const next = nextWithinLocale(parsed.data.next, locale);
  const callback = new URL("/api/auth/callback", clientEnv().NEXT_PUBLIC_APP_URL);
  callback.searchParams.set("locale", LOCALE_CODE[locale]);
  if (next) callback.searchParams.set("next", next);

  const supabase = await createActionClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: parsed.data.provider,
    options: { redirectTo: callback.toString(), skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    if (error) {
      const result = failure(error, "sign-in-provider");
      if (!result.ok) return result;
    }
    return { ok: false, error: "provider" };
  }

  redirect(data.url);
}

/** Sends the confirmation email again (AC-12); answers success for any address. Server action, anonymous. */
export async function resendConfirmation(
  _previous: AuthResult<{ email: string }> | null,
  input: unknown,
): Promise<AuthResult<{ email: string }>> {
  const locale = localeOf(input);
  const parsed = parseWith(emailRequestSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { email } = parsed.data;

  const supabase = await createActionClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmRedirectUrl(locale, "/app") },
  });
  if (error) {
    const result = failure(error, "resend-confirmation");
    return result.ok ? { ok: true, data: { email } } : result;
  }
  return { ok: true, data: { email } };
}

/** Sends the password reset link (AC-6); answers success for any address. Server action, anonymous. */
export async function requestPasswordReset(
  _previous: AuthResult<{ email: string }> | null,
  input: unknown,
): Promise<AuthResult<{ email: string }>> {
  const locale = localeOf(input);
  const parsed = parseWith(emailRequestSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const { email } = parsed.data;

  const supabase = await createActionClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: confirmRedirectUrl(locale, "/reset-password"),
  });
  if (error) {
    const result = failure(error, "request-password-reset");
    return result.ok ? { ok: true, data: { email } } : result;
  }
  return { ok: true, data: { email } };
}

/**
 * Saves a new password on a recovery or invite session (AC-6, AC-10), signs every other session
 * of the user out and lands on the role home. Without a session the link has expired. Server
 * action, authenticated.
 */
export async function updatePassword(
  _previous: AuthResult | null,
  input: unknown,
): Promise<AuthResult> {
  const locale = localeOf(input);
  const parsed = parseWith(updatePasswordSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createActionClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims) {
    redirect(`${localizedPath(locale, "/sign-in")}?error=link_expired&type=recovery`);
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const result = failure(error, "update-password");
    return result.ok ? { ok: false, error: "generic" } : result;
  }

  const { error: signOutError } = await supabase.auth.signOut({ scope: "others" });
  if (signOutError) {
    log.warn("revoking the other sessions failed", { reason: signOutError.message });
  }

  redirect(roleHomePath(roleFromClaims(claimsData.claims), locale));
}

/**
 * Finishes a provider sign up (AC-5, AC-8, AC-11) in the fixed order: record the consent, store
 * the page language, create the organization, land on `/app`. `already_member` counts as success.
 * Server action, client without an organization.
 */
export async function completeOnboarding(
  _previous: AuthResult | null,
  input: unknown,
): Promise<AuthResult> {
  const locale = localeOf(input);
  const parsed = parseWith(onboardingSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const supabase = await createActionClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = typeof claims?.sub === "string" ? claims.sub : null;
  if (!userId) redirect(`${localizedPath(locale, "/sign-in")}?error=session`);
  if (roleFromClaims(claims) !== "client") redirect(localizedPath(locale, "/forbidden"));

  const { error: consentError } = await supabase.rpc("accept_terms");
  if (consentError) {
    log.warn("accept_terms failed", { userId, reason: consentError.message });
    return { ok: false, error: "generic" };
  }

  const { error: localeError } = await supabase
    .from("profiles")
    .update({ locale: LOCALE_CODE[locale] })
    .eq("id", userId);
  if (localeError) log.warn("locale not persisted", { userId, reason: localeError.message });

  const result = await ensureOrganization(supabase, parsed.data.organizationName);
  if (!result.ok) {
    if (result.error === "not_a_client") redirect(localizedPath(locale, "/forbidden"));
    return { ok: false, error: "generic" };
  }

  redirect(landingPath(null, "client", locale));
}

/** Ends the session on this device only (AC-7) and returns to the marketing home. Server action, authenticated. */
export async function signOut(formData: FormData) {
  const parsed = signOutSchema.safeParse({ locale: formData.get("locale") });
  const locale = parsed.success ? parsed.data.locale : resolveLocale(undefined);

  const supabase = await createActionClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect(localizedPath(locale, "/"));
}
