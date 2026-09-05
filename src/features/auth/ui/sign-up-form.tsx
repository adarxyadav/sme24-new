"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestCode, resendConfirmation, signUp } from "@/features/auth/actions";
import { type SignUpInput, type SignUpValues, signUpSchema } from "@/features/auth/schema";
import { useRouter } from "@/i18n/navigation";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { AuthErrorAlert } from "./auth-error-alert";
import { InboxNotice } from "./inbox-notice";
import { ProviderButtons } from "./provider-buttons";
import { useAuthAction } from "./use-auth-action";

/** The code path drops the password: the same schema without that field (AC-2). */
const codeSchema = signUpSchema.extend({ password: z.string().max(256) });

/**
 * Sign up with a password or with an emailed code (AC-1, AC-2, AC-11): React Hook Form with the
 * feature schema, inline errors, the consent box, and the inbox state after a successful submit.
 * Browser.
 */
export function SignUpForm() {
  const t = useTranslations("auth.signUp");
  const v = useTranslations("auth.validation");
  const locale = useLocale();
  const router = useRouter();
  const [mode, setMode] = useState<"password" | "code">("password");
  const form = useForm<SignUpInput, unknown, SignUpValues>({
    resolver: zodResolver(mode === "password" ? signUpSchema : codeSchema, {
      error: zodLocaleError(locale),
    }),
    defaultValues: {
      fullName: "",
      organizationName: "",
      email: "",
      password: "",
      termsAccepted: false,
      locale,
    },
  });
  const password = useAuthAction<{ email: string }, SignUpInput>(signUp);
  const code = useAuthAction<{ email: string }, unknown>(requestCode);
  const { errors } = form.formState;
  const errorText = (message: string | undefined) => issueMessage(message, v);
  const pending = password.pending || code.pending;

  if (password.result?.ok) {
    return (
      <InboxNotice
        kind="signUp"
        email={password.result.data.email}
        locale={locale}
        resend={resendConfirmation}
      />
    );
  }
  if (code.result?.ok) {
    const email = code.result.data.email;
    router.push({ pathname: "/verify-code", query: { email } });
    return <InboxNotice kind="code" email={email} locale={locale} />;
  }

  const onSubmit = form.handleSubmit((values) => {
    if (mode === "password") password.submit({ ...values, locale });
    else {
      const { password: _omitted, ...rest } = values;
      code.submit({ ...rest, locale, purpose: "sign-up" });
    }
  });
  const failed = [password.result, code.result].find((result) => result?.ok === false);

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6">
      <AuthErrorAlert error={failed?.ok === false ? failed.error : null} />
      <FieldGroup>
        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="fullName">{t("fullName")}</FieldLabel>
          <Input
            id="fullName"
            autoComplete="name"
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={errors.fullName ? "fullName-error" : undefined}
            {...form.register("fullName")}
          />
          <FieldError id="fullName-error">{errorText(errors.fullName?.message)}</FieldError>
        </Field>
        <Field data-invalid={errors.organizationName ? true : undefined}>
          <FieldLabel htmlFor="organizationName">{t("organizationName")}</FieldLabel>
          <Input
            id="organizationName"
            autoComplete="organization"
            aria-invalid={errors.organizationName ? true : undefined}
            aria-describedby={errors.organizationName ? "organizationName-error" : undefined}
            {...form.register("organizationName")}
          />
          <FieldError id="organizationName-error">
            {errorText(errors.organizationName?.message)}
          </FieldError>
        </Field>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
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
        {mode === "password" ? (
          <Field data-invalid={errors.password ? true : undefined}>
            <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={errors.password ? "password-error" : "password-hint"}
              {...form.register("password")}
            />
            <FieldDescription id="password-hint">{t("passwordHint")}</FieldDescription>
            <FieldError id="password-error">{errorText(errors.password?.message)}</FieldError>
          </Field>
        ) : null}
        <Controller
          control={form.control}
          name="termsAccepted"
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid ? true : undefined}>
              <Checkbox
                id="termsAccepted"
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                aria-invalid={fieldState.invalid ? true : undefined}
                aria-describedby={fieldState.invalid ? "termsAccepted-error" : undefined}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="termsAccepted" className="font-normal">
                  {t("consent")}
                </FieldLabel>
                <FieldError id="termsAccepted-error">
                  {errorText(fieldState.error?.message)}
                </FieldError>
              </div>
            </Field>
          )}
        />
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {mode === "password" ? t("submit") : t("codeInstead")}
        </Button>
        {mode === "password" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              form.clearErrors("password");
              setMode("code");
            }}
          >
            {t("codeInstead")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setMode("password")}
          >
            {t("password")}
          </Button>
        )}
      </div>
      <ProviderButtons />
    </form>
  );
}
