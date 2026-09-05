"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { requestCode, verifyCode } from "@/features/auth/actions";
import { type VerifyCodeInput, verifyCodeSchema } from "@/features/auth/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { AuthErrorAlert } from "./auth-error-alert";
import { useAuthAction } from "./use-auth-action";

const SLOTS = [0, 1, 2, 3, 4, 5] as const;

/**
 * The six digit code page (AC-2, AC-4): the email the code went to (editable, prefilled from the
 * query), the OTP input, and a resend that never reveals whether the address exists. Browser.
 */
export function VerifyCodeForm({
  email,
  next,
}: {
  readonly email: string;
  readonly next?: string;
}) {
  const t = useTranslations("auth.verifyCode");
  const v = useTranslations("auth.validation");
  const locale = useLocale();
  const form = useForm<VerifyCodeInput>({
    resolver: zodResolver(verifyCodeSchema, { error: zodLocaleError(locale) }),
    defaultValues: { email, token: "", locale, next },
  });
  const verify = useAuthAction<undefined, VerifyCodeInput>(verifyCode);
  const resend = useAuthAction<{ email: string }, unknown>(requestCode);
  const { errors } = form.formState;
  const pending = verify.pending || resend.pending;
  const failed = [verify.result, resend.result].find((result) => result?.ok === false);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => verify.submit({ ...values, locale, next }))}
      className="flex flex-col gap-6"
    >
      <AuthErrorAlert error={failed?.ok === false ? failed.error : null} />
      {resend.result?.ok ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("resent")}
        </p>
      ) : null}
      <FieldGroup>
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
          <FieldError id="email-error">{issueMessage(errors.email?.message, v)}</FieldError>
        </Field>
        <Controller
          control={form.control}
          name="token"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid ? true : undefined}>
              <FieldLabel htmlFor="token">{t("code")}</FieldLabel>
              <InputOTP
                id="token"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                aria-invalid={fieldState.invalid ? true : undefined}
                aria-describedby={fieldState.invalid ? "token-error" : undefined}
              >
                <InputOTPGroup>
                  {SLOTS.map((index) => (
                    <InputOTPSlot key={index} index={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              <FieldError id="token-error">{issueMessage(fieldState.error?.message, v)}</FieldError>
            </Field>
          )}
        />
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" disabled={pending}>
          {t("submit")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            resend.submit({ purpose: "sign-in", email: form.getValues("email"), locale, next })
          }
        >
          {t("resend")}
        </Button>
      </div>
    </form>
  );
}
