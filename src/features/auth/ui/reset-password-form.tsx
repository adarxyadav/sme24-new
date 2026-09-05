"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { updatePassword } from "@/features/auth/actions";
import { type UpdatePasswordInput, updatePasswordSchema } from "@/features/auth/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { AuthErrorAlert } from "./auth-error-alert";
import { useAuthAction } from "./use-auth-action";

/** The new password after a recovery or invite link (AC-6, AC-10); the action redirects on success. Browser. */
export function ResetPasswordForm() {
  const t = useTranslations("auth.resetPassword");
  const v = useTranslations("auth.validation");
  const locale = useLocale();
  const form = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordSchema, { error: zodLocaleError(locale) }),
    defaultValues: { password: "", locale },
  });
  const action = useAuthAction<undefined, UpdatePasswordInput>(updatePassword);
  const { errors } = form.formState;

  return (
    <form
      noValidate
      method="post"
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      className="flex flex-col gap-6"
    >
      <AuthErrorAlert error={action.result?.ok === false ? action.result.error : null} />
      <FieldGroup>
        <Field data-invalid={errors.password ? true : undefined}>
          <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={errors.password ? true : undefined}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
          <FieldError id="password-error">{issueMessage(errors.password?.message, v)}</FieldError>
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={action.pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
