"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { completeExpertOnboarding, type OnboardingResult } from "@/features/experts/actions";
import { LANGUAGE_CODES, REGION_CODES } from "@/features/experts/catalogue";
import {
  type OnboardingInput,
  type OnboardingValues,
  onboardingSchema,
} from "@/features/experts/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { CodeCheckboxGroup } from "./code-checkbox-group";

export type ExpertOnboardingFormProps = {
  readonly fullName: string;
  readonly headline: string;
};

/**
 * The expert's first screen (spec 0013, AC-4): consent, their name, one line describing what they
 * do, and the languages and cantons they work in. Deliberately shorter than the full profile,
 * because these are the fields without which an expert cannot be matched or assigned at all; the
 * rest waits for `/expert/profile`.
 *
 * A success refreshes rather than pushing a route: the gate on the expert layout is what decides
 * where an onboarded expert belongs, so one source decides it instead of two. Browser.
 */
export function ExpertOnboardingForm({ fullName, headline }: ExpertOnboardingFormProps) {
  const t = useTranslations("experts.onboarding");
  const errorText = useTranslations("experts.form.errors");
  const catalogue = useTranslations("experts.catalogue");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<OnboardingInput, unknown, OnboardingValues>({
    resolver: zodResolver(onboardingSchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      termsAccepted: false,
      fullName,
      headline,
      languages: [],
      regions: [],
      locale,
    },
  });
  const action = useFormAction<OnboardingResult, OnboardingValues>(completeExpertOnboarding);
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
      data-expert-onboarding
    >
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="expert-full-name">{t("fullName")}</FieldLabel>
          <Input
            id="expert-full-name"
            autoComplete="name"
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={errors.fullName ? "expert-full-name-error" : undefined}
            {...form.register("fullName")}
          />
          <FieldError id="expert-full-name-error">
            {issueMessage(errors.fullName?.message, errorText)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.headline ? true : undefined}>
          <FieldLabel htmlFor="expert-headline">{t("headline")}</FieldLabel>
          <Input
            id="expert-headline"
            placeholder={t("headlinePlaceholder")}
            aria-invalid={errors.headline ? true : undefined}
            aria-describedby={errors.headline ? "expert-headline-error" : undefined}
            {...form.register("headline")}
          />
          <FieldError id="expert-headline-error">
            {issueMessage(errors.headline?.message, errorText)}
          </FieldError>
        </Field>

        <Controller
          control={form.control}
          name="languages"
          render={({ field, fieldState }) => (
            <CodeCheckboxGroup
              codes={LANGUAGE_CODES}
              value={field.value ?? []}
              onValueChange={(value) => field.onChange([...value])}
              labelFor={(code) => catalogue(`languages.${code as "de"}`)}
              legend={t("languages")}
              error={issueMessage(fieldState.error?.message, errorText)}
              idPrefix="expert-languages"
              columns={2}
            />
          )}
        />

        <Controller
          control={form.control}
          name="regions"
          render={({ field, fieldState }) => (
            <CodeCheckboxGroup
              codes={REGION_CODES}
              value={field.value ?? []}
              onValueChange={(value) => field.onChange([...value])}
              labelFor={(code) => catalogue(`regions.${code as "AG"}`)}
              legend={t("regions")}
              description={t("regionsHint")}
              error={issueMessage(fieldState.error?.message, errorText)}
              idPrefix="expert-regions"
              columns={4}
            />
          )}
        />

        <Controller
          control={form.control}
          name="termsAccepted"
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid ? true : undefined}>
              <Checkbox
                id="expert-terms"
                checked={field.value === true}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                aria-invalid={fieldState.invalid ? true : undefined}
                aria-describedby={fieldState.invalid ? "expert-terms-error" : undefined}
              />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="expert-terms" className="font-normal">
                  {t("consent")}
                </FieldLabel>
                <FieldError id="expert-terms-error">
                  {issueMessage(fieldState.error?.message, errorText)}
                </FieldError>
              </div>
            </Field>
          )}
        />
      </FieldGroup>

      <Button type="submit" size="lg" disabled={action.pending}>
        {action.pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
