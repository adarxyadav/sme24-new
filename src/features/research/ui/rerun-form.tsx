"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { rerunResearch } from "@/features/research/actions";
import { type RerunInput, type RerunValues, rerunSchema } from "@/features/research/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { ResearchErrorAlert } from "./research-error-alert";
import { useResearchAction } from "./use-research-action";

export type RerunFormProps = {
  readonly company: {
    readonly id: string;
    readonly name: string;
    readonly legalName: string | null;
    readonly website: string | null;
  };
  /** Why the button is disabled: a run still open, the quota used up, or nothing. */
  readonly blocked: "open" | "quota" | null;
};

/**
 * The edit and rerun form on the empty and failed states (spec 0007, AC-8): name, legal name and
 * website, a plain update where the client's values win, then the next run. Disabled while a run
 * is open or the daily quota is used up. Browser.
 */
export function RerunForm({ company, blocked }: RerunFormProps) {
  const t = useTranslations("research.rerun");
  const v = useTranslations("research.validation");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<RerunInput, unknown, RerunValues>({
    resolver: zodResolver(rerunSchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      companyId: company.id,
      name: company.name,
      legalName: company.legalName ?? "",
      website: company.website ? company.website.replace(/^https:\/\//, "") : "",
      locale,
    },
  });
  const action = useResearchAction<{ runId: string }, RerunValues>(rerunResearch);
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);

  const disabled = action.pending || blocked !== null || (result?.ok ?? false);

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
          <FieldLabel htmlFor="rerun-name">{t("name")}</FieldLabel>
          <Input
            id="rerun-name"
            autoComplete="organization"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "rerun-name-error" : undefined}
            {...form.register("name")}
          />
          <FieldError id="rerun-name-error">{issueMessage(errors.name?.message, v)}</FieldError>
        </Field>
        <Field data-invalid={errors.legalName ? true : undefined}>
          <FieldLabel htmlFor="rerun-legal-name">{t("legalName")}</FieldLabel>
          <Input
            id="rerun-legal-name"
            aria-invalid={errors.legalName ? true : undefined}
            aria-describedby={errors.legalName ? "rerun-legal-name-error" : undefined}
            {...form.register("legalName")}
          />
          <FieldError id="rerun-legal-name-error">
            {issueMessage(errors.legalName?.message, v)}
          </FieldError>
        </Field>
        <Field data-invalid={errors.website ? true : undefined}>
          <FieldLabel htmlFor="rerun-website">{t("website")}</FieldLabel>
          <Input
            id="rerun-website"
            inputMode="url"
            autoComplete="url"
            placeholder={t("websitePlaceholder")}
            aria-invalid={errors.website ? true : undefined}
            aria-describedby={errors.website ? "rerun-website-error" : undefined}
            {...form.register("website")}
          />
          <FieldError id="rerun-website-error">
            {issueMessage(errors.website?.message, v)}
          </FieldError>
        </Field>
      </FieldGroup>
      <div className="flex flex-col gap-2">
        <Button
          type="submit"
          disabled={disabled}
          aria-describedby={blocked ? "rerun-blocked" : undefined}
        >
          {action.pending ? t("submitting") : t("submit")}
        </Button>
        {blocked ? (
          <FieldDescription id="rerun-blocked">
            {blocked === "open" ? t("blockedOpen") : t("blockedQuota")}
          </FieldDescription>
        ) : null}
      </div>
    </form>
  );
}
