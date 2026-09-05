"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { completeOnboarding } from "@/features/auth/actions";
import { type OnboardingInput, onboardingSchema } from "@/features/auth/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { AuthErrorAlert } from "./auth-error-alert";
import { useAuthAction } from "./use-auth-action";

/**
 * The company name and the consent box for a client who signed up through a provider (AC-5,
 * AC-8, AC-11); the submit is disabled while the action runs so a double click cannot create two
 * organizations. Browser.
 */
export function OnboardingForm({ organizationName }: { readonly organizationName: string }) {
  const t = useTranslations("auth.onboarding");
  const v = useTranslations("auth.validation");
  const locale = useLocale();
  const form = useForm<OnboardingInput>({
    resolver: zodResolver(onboardingSchema, { error: zodLocaleError(locale) }),
    defaultValues: { organizationName, termsAccepted: false, locale },
  });
  const action = useAuthAction<undefined, OnboardingInput>(completeOnboarding);
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      className="flex flex-col gap-6"
    >
      <AuthErrorAlert error={action.result?.ok === false ? action.result.error : null} />
      <FieldGroup>
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
            {issueMessage(errors.organizationName?.message, v)}
          </FieldError>
        </Field>
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
                  {issueMessage(fieldState.error?.message, v)}
                </FieldError>
              </div>
            </Field>
          )}
        />
      </FieldGroup>
      <Button type="submit" size="lg" disabled={action.pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
