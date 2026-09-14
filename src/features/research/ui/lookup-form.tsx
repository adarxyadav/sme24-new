"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { CountrySelect } from "@/components/country-select";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type ResearchActionResult, requestResearch } from "@/features/research/actions";
import { type LookupInput, type LookupValues, lookupSchema } from "@/features/research/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { useRouter } from "@/i18n/navigation";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { ResearchErrorAlert } from "./research-error-alert";

/**
 * The lookup form (spec 0007, AC-3): the company name prefilled from the organization and an
 * optional website. On a success (or `company_exists`, which names the company that won a double
 * submit) it goes to that company's own page, where the queued run renders; `redirectToCompany`
 * false keeps the old behaviour of refreshing in place, which is what the dashboard's own empty
 * state wants. Browser.
 */
export function LookupForm({
  organizationName,
  redirectToCompany = false,
}: {
  readonly organizationName: string;
  /** Navigate to the new company's page instead of refreshing this one. */
  readonly redirectToCompany?: boolean;
}) {
  const t = useTranslations("research.lookup");
  const v = useTranslations("research.validation");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<LookupInput, unknown, LookupValues>({
    resolver: zodResolver(lookupSchema, { error: zodLocaleError(locale) }),
    // No country default: the client picks one, so a company is never created as CH by
    // accident (spec 0022, AC-1).
    defaultValues: { name: organizationName, country: undefined, website: "", locale },
  });
  const action = useFormAction<
    ResearchActionResult<{ companyId: string; runId: string }>,
    LookupValues & { locale: string }
  >(requestResearch);
  const { errors } = form.formState;
  const result = action.result;

  // In the handler that awaited this one dispatch, never an effect watching `result`:
  // `useActionState` holds its last value for the life of the component, so an effect would
  // navigate again on every later render.
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await action.submit({ ...values, locale });
    // `company_exists` names the company a double submit created first, so both answers point at
    // a real company to open.
    const companyId = outcome.ok
      ? outcome.data.companyId
      : outcome.error === "company_exists"
        ? outcome.companyId
        : null;
    if (!companyId) return;
    if (redirectToCompany) {
      router.push({ pathname: "/app/companies/[companyId]", params: { companyId } });
      return;
    }
    router.refresh();
  });

  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-6" aria-busy={action.pending}>
      <ResearchErrorAlert result={result} />
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="company-name">{t("name")}</FieldLabel>
          <Input
            id="company-name"
            autoComplete="organization"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "company-name-error" : undefined}
            {...form.register("name")}
          />
          <FieldError id="company-name-error">{issueMessage(errors.name?.message, v)}</FieldError>
        </Field>
        <Controller
          control={form.control}
          name="country"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid ? true : undefined}>
              <FieldLabel htmlFor="company-country">{t("country")}</FieldLabel>
              <CountrySelect
                id="company-country"
                value={field.value ?? ""}
                onValueChange={field.onChange}
                placeholder={t("countryPlaceholder")}
                europeLabel={t("countryEurope")}
                restLabel={t("countryRest")}
                invalid={fieldState.invalid}
                describedBy={fieldState.invalid ? "company-country-error" : "company-country-hint"}
              />
              <FieldDescription id="company-country-hint">{t("countryHint")}</FieldDescription>
              <FieldError id="company-country-error">
                {issueMessage(fieldState.error?.message, v)}
              </FieldError>
            </Field>
          )}
        />
        <Field data-invalid={errors.website ? true : undefined}>
          <FieldLabel htmlFor="company-website">{t("website")}</FieldLabel>
          <Input
            id="company-website"
            inputMode="url"
            autoComplete="url"
            placeholder={t("websitePlaceholder")}
            aria-invalid={errors.website ? true : undefined}
            aria-describedby={errors.website ? "company-website-error" : "company-website-hint"}
            {...form.register("website")}
          />
          <FieldDescription id="company-website-hint">{t("websiteHint")}</FieldDescription>
          <FieldError id="company-website-error">
            {issueMessage(errors.website?.message, v)}
          </FieldError>
        </Field>
      </FieldGroup>
      <Button type="submit" size="lg" disabled={action.pending || (result?.ok ?? false)}>
        {action.pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
