import { z } from "zod";
import { LOCALES } from "@/i18n/routing";

/**
 * Input schemas of the auth actions (spec 0005). Custom rules carry keys of `auth.validation`;
 * built in rules (required, invalid email) keep Zod's messages, which `parseWith` and the form
 * resolver deliver in the request language (spec 0004).
 */

/** The full locale tag the page passes along (`de-CH`), so messages and redirects match the URL. */
export const localeSchema = z.enum(LOCALES);

/** A trimmed, lower cased email address. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

/** At least 8 characters (spec 0005, security model); Supabase enforces the same minimum. */
export const passwordSchema = z.string().min(8, "passwordShort").max(256);

/** The consent box must be ticked (AC-11). */
export const consentSchema = z.boolean().refine((value) => value === true, "consentRequired");

const nextSchema = z.string().max(2048).optional();
const nameSchema = z.string().trim().min(1, "nameRequired").max(200);
const organizationNameSchema = z.string().trim().min(1, "organizationRequired").max(200);

/** Password sign up (AC-1). */
export const signUpSchema = z.object({
  fullName: nameSchema,
  organizationName: organizationNameSchema,
  email: emailSchema,
  password: passwordSchema,
  termsAccepted: consentSchema,
  locale: localeSchema,
});
export type SignUpInput = z.input<typeof signUpSchema>;
export type SignUpValues = z.output<typeof signUpSchema>;

/** Sign up without a password: the same fields, the code path (AC-2). */
export const signUpWithCodeSchema = signUpSchema.omit({ password: true });

/**
 * Email code request (AC-2, AC-4): `sign-up` carries the sign up fields and creates the user,
 * `sign-in` carries only the email and never creates one.
 */
export const requestCodeSchema = z.discriminatedUnion("purpose", [
  signUpWithCodeSchema.extend({ purpose: z.literal("sign-up") }),
  z.object({
    purpose: z.literal("sign-in"),
    email: emailSchema,
    locale: localeSchema,
    next: nextSchema,
  }),
]);
export type RequestCodeInput = z.input<typeof requestCodeSchema>;

/** The six digit code and the email it was sent to (AC-2, AC-4). */
export const verifyCodeSchema = z.object({
  email: emailSchema,
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "codeLength"),
  locale: localeSchema,
  next: nextSchema,
});
export type VerifyCodeInput = z.input<typeof verifyCodeSchema>;

/** Password sign in (AC-3). The length rule is not applied here: a wrong password is generic. */
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  locale: localeSchema,
  next: nextSchema,
});
export type SignInInput = z.input<typeof signInSchema>;

/** An email plus the locale for the resend and reset request actions (AC-6, AC-12). */
export const emailRequestSchema = z.object({ email: emailSchema, locale: localeSchema });
export type EmailRequestInput = z.input<typeof emailRequestSchema>;

/** The new password after a recovery or invite link (AC-6, AC-10). */
export const updatePasswordSchema = z.object({ password: passwordSchema, locale: localeSchema });
export type UpdatePasswordInput = z.input<typeof updatePasswordSchema>;

/** The onboarding form for a client without an organization (AC-5, AC-8). */
export const onboardingSchema = z.object({
  organizationName: organizationNameSchema,
  termsAccepted: consentSchema,
  locale: localeSchema,
});
export type OnboardingInput = z.input<typeof onboardingSchema>;

/** The two providers (AC-5); Supabase calls Microsoft `azure`. */
export const providerSchema = z.enum(["google", "azure"]);
export type Provider = z.infer<typeof providerSchema>;

export const signInWithProviderSchema = z.object({
  provider: providerSchema,
  locale: localeSchema,
  next: nextSchema,
});
export type SignInWithProviderInput = z.input<typeof signInWithProviderSchema>;

export const signOutSchema = z.object({ locale: localeSchema });
