"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { requestResearch } from "@/features/research/actions";
import { type LookupInput, type LookupValues, lookupSchema } from "@/features/research/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { ResearchErrorAlert } from "./research-error-alert";
import { useResearchAction } from "./use-research-action";

/**
 * The lookup form (spec 0007, AC-3): the company name prefilled from the organization and an
 * optional website. A success (or `company_exists`) refreshes the page so the server renders the
 * dashboard with the run in `queued`. Browser.
 */
export function LookupForm({ organizationName }: { readonly organizationName: string }) {
  const t = useTranslations("research.lookup");
  const v = useTranslations("research.validation");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<LookupInput, unknown, LookupValues>({
    resolver: zodResolver(lookupSchema, { error: zodLocaleError(locale) }),
    defaultValues: { name: organizationName, website: "", locale },
  });
  const action = useResearchAction<{ companyId: string; runId: string }, LookupValues>(
    requestResearch,
  );
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (result?.ok || result?.error === "company_exists") router.refresh();
  }, [result, router]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      className="flex flex-col gap-6"
      aria-busy={action.pending}
    >
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
