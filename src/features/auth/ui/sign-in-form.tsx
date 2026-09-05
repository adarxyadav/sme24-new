"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, MailWarningIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type AuthResult,
  requestCode,
  requestPasswordReset,
  resendConfirmation,
  signIn,
} from "@/features/auth/actions";
import type { LinkExpiredType, SignInNotice } from "@/features/auth/notices";
import { type SignInInput, signInSchema } from "@/features/auth/schema";
import { Link, useRouter } from "@/i18n/navigation";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { AuthErrorAlert } from "./auth-error-alert";
import { InboxNotice } from "./inbox-notice";
import { ProviderButtons } from "./provider-buttons";
import { useAuthAction } from "./use-auth-action";

export type SignInFormProps = {
  readonly next?: string;
  readonly notice?: SignInNotice;
};

type EmailAction = (
  previous: AuthResult<{ email: string }> | null,
  input: unknown,
) => Promise<AuthResult<{ email: string }>>;

/** The action that sends a fresh email of the failed type; null for an invite (ask the administrator). */
function resendActionFor(type: LinkExpiredType): EmailAction | null {
  switch (type) {
    case "signup":
      return resendConfirmation;
    case "magiclink":
    case "email":
      return requestCode;
    case "recovery":
      return requestPasswordReset;
    case "invite":
      return null;
  }
}

/**
 * Password sign in with the code alternative (AC-3, AC-4, AC-12): one generic message for a wrong
 * password, the resend offer for an unconfirmed account, and the expired link and handler error
 * notices the page reads from the query. Browser.
 */
export function SignInForm({ next, notice }: SignInFormProps) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema, { error: zodLocaleError(locale) }),
    defaultValues: { email: "", password: "", locale, next },
  });
  const signInAction = useAuthAction<undefined, SignInInput>(signIn);
  const codeAction = useAuthAction<{ email: string }, unknown>(requestCode);
  const resendAction = useAuthAction<{ email: string }, unknown>(resendConfirmation);
  const expiredType = notice?.kind === "linkExpired" ? notice.type : null;
  const expiredResend = useAuthAction<{ email: string }, unknown>(
    (expiredType && resendActionFor(expiredType)) ?? resendConfirmation,
  );
  const { errors } = form.formState;
  const errorText = (message: string | undefined) =>
    issueMessage(message, t as unknown as Parameters<typeof issueMessage>[1]);
  const pending =
    signInAction.pending || codeAction.pending || resendAction.pending || expiredResend.pending;

  if (codeAction.result?.ok) {
    const email = codeAction.result.data.email;
    router.push({ pathname: "/verify-code", query: next ? { email, next } : { email } });
    return <InboxNotice kind="code" email={email} locale={locale} />;
  }
  if (resendAction.result?.ok) {
    return (
      <InboxNotice
        kind="signUp"
        email={resendAction.result.data.email}
        locale={locale}
        resend={resendConfirmation}
      />
    );
  }
  if (expiredResend.result?.ok && expiredType) {
    const email = expiredResend.result.data.email;
    if (expiredType === "magiclink" || expiredType === "email") {
      router.push({ pathname: "/verify-code", query: { email } });
    }
    return (
      <InboxNotice
        kind={expiredType === "signup" ? "signUp" : expiredType === "recovery" ? "reset" : "code"}
        email={email}
        locale={locale}
      />
    );
  }

  /** Reads a valid email from the form for the secondary actions, marking the field otherwise. */
  const withEmail = (run: (email: string) => void) => {
    const email = form.getValues("email").trim();
    if (!email) {
      form.setError("email", { type: "required", message: undefined });
      form.setFocus("email");
      return;
    }
    run(email);
  };
  const requestSignInCode = () =>
    withEmail((email) => codeAction.submit({ purpose: "sign-in", email, locale, next }));
  const resendForExpired = () =>
    withEmail((email) =>
      expiredResend.submit(
        expiredType === "magiclink" || expiredType === "email"
          ? { purpose: "sign-in", email, locale }
          : { email, locale },
      ),
    );

  const signInError = signInAction.result?.ok === false ? signInAction.result.error : null;
  const secondaryError = [codeAction.result, resendAction.result, expiredResend.result].find(
    (result) => result?.ok === false,
  );

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => signInAction.submit({ ...values, locale, next }))}
      className="flex flex-col gap-6"
    >
      {notice?.kind === "linkExpired" ? (
        <Alert variant="warning">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t("linkExpired.title")}</AlertTitle>
          <AlertDescription>
            {t(
              `linkExpired.${
                notice.type === "magiclink" || notice.type === "email" ? "code" : notice.type
              }`,
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {notice?.kind === "error" ? <AuthErrorAlert error={notice.error} /> : null}
      {signInError === "emailNotConfirmed" ? (
        <Alert variant="warning">
          <MailWarningIcon aria-hidden="true" />
          <AlertTitle>{t("unconfirmed.title")}</AlertTitle>
          <AlertDescription>{t("unconfirmed.body")}</AlertDescription>
        </Alert>
      ) : (
        <AuthErrorAlert error={signInError} />
      )}
      <AuthErrorAlert error={secondaryError?.ok === false ? secondaryError.error : null} />
      <FieldGroup>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">{t("signIn.email")}</FieldLabel>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
          <FieldError id="email-error">{errorText(errors.email?.message)}</FieldError>
        </Field>
        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">{t("signIn.password")}</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
          <FieldError id="password-error">{errorText(errors.password?.message)}</FieldError>
          <Link href="/forgot-password" className="self-start text-sm underline">
            {t("signIn.forgotPassword")}
          </Link>
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {t("signIn.submit")}
        </Button>
        {signInError === "emailNotConfirmed" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => withEmail((email) => resendAction.submit({ email, locale }))}
          >
            {t("unconfirmed.resend")}
          </Button>
        ) : null}
        {expiredType && expiredType !== "invite" ? (
          <Button type="button" variant="outline" disabled={pending} onClick={resendForExpired}>
            {t("linkExpired.resend")}
          </Button>
        ) : null}
        <Button type="button" variant="ghost" disabled={pending} onClick={requestSignInCode}>
          {t("signIn.codeInstead")}
        </Button>
      </div>
      <ProviderButtons next={next} />
    </form>
  );
}
