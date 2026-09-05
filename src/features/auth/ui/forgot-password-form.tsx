"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/features/auth/actions";
import { type EmailRequestInput, emailRequestSchema } from "@/features/auth/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { AuthErrorAlert } from "./auth-error-alert";
import { InboxNotice } from "./inbox-notice";
import { useAuthAction } from "./use-auth-action";

/** Asks for the email and always lands on the inbox state (AC-6). Browser. */
export function ForgotPasswordForm() {
  const t = useTranslations("auth.forgotPassword");
  const v = useTranslations("auth.validation");
  const locale = useLocale();
  const form = useForm<EmailRequestInput>({
    resolver: zodResolver(emailRequestSchema, { error: zodLocaleError(locale) }),
    defaultValues: { email: "", locale },
  });
  const action = useAuthAction<{ email: string }, EmailRequestInput>(requestPasswordReset);
  const { errors } = form.formState;

  if (action.result?.ok) {
    return (
      <InboxNotice
        kind="reset"
        email={action.result.data.email}
        locale={locale}
        resend={requestPasswordReset}
      />
    );
  }

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      className="flex flex-col gap-6"
    >
      <AuthErrorAlert error={action.result?.ok === false ? action.result.error : null} />
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
      </FieldGroup>
      <Button type="submit" size="lg" disabled={action.pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
