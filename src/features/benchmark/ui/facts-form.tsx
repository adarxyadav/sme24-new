"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type BenchmarkActionResult,
  type UpdateCompanyFactsData,
  updateCompanyFacts,
} from "@/features/benchmark/actions";
import { NOGA_SECTIONS } from "@/features/benchmark/catalogue";
import {
  type CompanyFactsInput,
  type CompanyFactsValues,
  companyFactsFormSchema,
  divisionOf,
} from "@/features/benchmark/schema";
import { issueMessage, zodLocaleError } from "@/lib/validation";

export type FactsFormProps = {
  readonly company: {
    readonly id: string;
    readonly industryCode: string | null;
    readonly employeesCount: number | null;
  };
};

/**
 * The company facts form (spec 0008, AC-11): the NOGA division grouped by section and the
 * headcount. Only a changed field is sent, so an untouched `23.61` is never flattened to `23`;
 * a success refreshes the page, which shows `calculating` until the new snapshot lands. Browser.
 */
export function FactsForm({ company }: FactsFormProps) {
  const t = useTranslations("benchmark.facts");
  const v = useTranslations("benchmark.facts.validation");
  const errorsT = useTranslations("benchmark.errors");
  const noga = useTranslations("benchmark.noga");
  const locale = useLocale();
  const router = useRouter();
  const initialDivision = divisionOf(company.industryCode);
  const initialEmployees = company.employeesCount === null ? "" : String(company.employeesCount);
  const form = useForm<CompanyFactsInput, unknown, CompanyFactsValues>({
    resolver: zodResolver(companyFactsFormSchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      companyId: company.id,
      industryCode: initialDivision,
      employeesCount: initialEmployees,
      locale,
    },
  });
  const [result, dispatch, pending] = useActionState<
    BenchmarkActionResult<UpdateCompanyFactsData> | null,
    unknown
  >(updateCompanyFacts, null);
  const { errors } = form.formState;

  useEffect(() => {
    if (result?.ok) router.refresh();
  }, [result, router]);

  const submit = form.handleSubmit((values) => {
    // Only what changed goes to the server (the schema then demands at least one field).
    const division = values.industryCode ?? "";
    const employees = values.employeesCount;
    startTransition(() =>
      dispatch({
        companyId: company.id,
        industryCode: division !== "" && division !== initialDivision ? division : undefined,
        employeesCount:
          employees !== undefined && String(employees) !== initialEmployees ? employees : undefined,
        locale,
      }),
    );
  });

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-6"
      aria-busy={pending}
      data-facts-form
    >
      {result && !result.ok ? (
        <Alert variant="destructive" role="alert" data-error={result.error}>
          <OctagonXIcon aria-hidden="true" />
          <AlertTitle>{errorsT(result.error)}</AlertTitle>
        </Alert>
      ) : null}
      {result?.ok ? (
        <p className="text-sm" role="status" data-facts-saved={result.data.benchmarkQueued}>
          {result.data.benchmarkQueued ? t("saved") : t("savedNotQueued")}
        </p>
      ) : null}
      <FieldGroup>
        <Controller
          control={form.control}
          name="industryCode"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid ? true : undefined}>
              <FieldLabel htmlFor="facts-industry">{t("industry")}</FieldLabel>
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger
                  id="facts-industry"
                  aria-invalid={fieldState.invalid ? true : undefined}
                  aria-describedby={fieldState.invalid ? "facts-industry-error" : undefined}
                  className="w-full"
                >
                  <SelectValue placeholder={t("industryPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {NOGA_SECTIONS.map(({ letter, divisions: [from, to] }) => (
                    <SelectGroup key={letter}>
                      <SelectLabel>
                        {letter} · {noga(`sections.${letter as "A"}`)}
                      </SelectLabel>
                      {Array.from({ length: to - from + 1 }, (_, index) =>
                        String(from + index).padStart(2, "0"),
                      ).map((division) => (
                        <SelectItem key={division} value={division}>
                          {division} · {noga(`divisions.${division as "01"}`)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <FieldError id="facts-industry-error">
                {issueMessage(fieldState.error?.message, v)}
              </FieldError>
            </Field>
          )}
        />
        <Field data-invalid={errors.employeesCount ? true : undefined}>
          <FieldLabel htmlFor="facts-employees">{t("employees")}</FieldLabel>
          <Input
            id="facts-employees"
            type="number"
            inputMode="numeric"
            min={1}
            max={1_000_000}
            step={1}
            aria-invalid={errors.employeesCount ? true : undefined}
            aria-describedby={
              errors.employeesCount ? "facts-employees-error" : "facts-employees-hint"
            }
            {...form.register("employeesCount")}
          />
          <FieldDescription id="facts-employees-hint">{t("employeesHint")}</FieldDescription>
          <FieldError id="facts-employees-error">
            {issueMessage(errors.employeesCount?.message, v)}
          </FieldError>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
