"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { KpiFormat, KpiKey } from "@/features/research/catalogue";
import type { KpiRow } from "@/features/research/queries";
import {
  type ClearClientKpiData,
  clearClientKpi,
  type SaveClientKpisData,
  type SelfAssessmentActionResult,
  saveClientKpis,
} from "@/features/self-assessment/actions";
import {
  type ClientKpisInput,
  type ClientKpisValues,
  clientKpisFormSchema,
} from "@/features/self-assessment/schema";
import { defaultYear, newerYearsThan, yearOptions } from "@/features/self-assessment/years";
import { issueMessage, zodLocaleError } from "@/lib/validation";

/** One field of the form: the catalogue KPI with its localized texts (spec 0010, AC-3). */
export type KpiFormField = {
  readonly key: KpiKey;
  readonly name: string;
  readonly description: string;
  readonly unit: string;
  readonly format: KpiFormat;
};

export type KpiFormProps = {
  readonly companyId: string;
  /** The active catalogue in sort order, localized by the server section. */
  readonly fields: readonly KpiFormField[];
  /** Every current row of the company (AC-10); the form prefills from these without a round trip. */
  readonly rows: readonly KpiRow[];
  /** The `Europe/Zurich` calendar year of the server clock (AC-2). */
  readonly currentYear: number;
};

type SaveResult = SelfAssessmentActionResult<SaveClientKpisData>;
type ClearResult = SelfAssessmentActionResult<ClearClientKpiData>;
type FieldValues = ClientKpisInput["values"];

/** The Radix select needs a non empty value, so "not set" carries this sentinel in the picker only. */
const UNSET = "unset";

/** The text value a field starts with for (KPI, year): the current row's value, else empty. Pure. */
export function prefillValues(
  fields: readonly KpiFormField[],
  rows: readonly KpiRow[],
  year: number,
): FieldValues {
  return Object.fromEntries(
    fields.map((field) => {
      const row = rows.find((entry) => entry.kpiKey === field.key && entry.periodYear === year);
      if (!row) return [field.key, ""];
      return [
        field.key,
        field.format === "yesNo" ? (row.value >= 1 ? "1" : "0") : String(row.value),
      ];
    }),
  ) as FieldValues;
}

/** The values that differ from the prefilled ones; an untouched field is `undefined` and never sent (AC-4). Pure. */
export function changedValues(values: FieldValues, prefilled: FieldValues): FieldValues {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const current = value === null || value === undefined ? "" : String(value).trim();
      const initial = prefilled[key as KpiKey] ?? "";
      return [key, current === String(initial) ? undefined : value];
    }),
  ) as FieldValues;
}

/**
 * The self assessment form (spec 0010, AC-3, AC-4, AC-7): one year picker for the whole form,
 * one typed field per catalogue KPI prefilled from the current rows with a caption naming the
 * source, a clear button beside a field that holds a client value, the older year hint and the
 * save button. Only fields that differ from their prefilled value reach the action (the resolver
 * blanks the rest), a year change refills every field and drops unsaved edits, and a success
 * refreshes the page so the table, the badge and the benchmark segment render on the server.
 * Browser.
 */
export function KpiForm({ companyId, fields, rows, currentYear }: KpiFormProps) {
  const t = useTranslations("selfAssessment");
  const v = useTranslations("selfAssessment.validation");
  const errorsT = useTranslations("selfAssessment.errors");
  const locale = useLocale();
  const format = useFormatter();
  const router = useRouter();

  const yearsOnFile = useMemo(() => [...new Set(rows.map((row) => row.periodYear))], [rows]);
  const years = yearOptions({ yearsOnFile, currentYear });
  const initialYear = defaultYear({ yearsOnFile, currentYear });
  const prefilled = useRef(prefillValues(fields, rows, initialYear));

  const resolver = useMemo(() => {
    const base = zodResolver<ClientKpisInput, unknown, ClientKpisValues>(
      clientKpisFormSchema(currentYear),
      { error: zodLocaleError(locale) },
    );
    const withChangedOnly: typeof base = (values, context, options) =>
      base(
        { ...values, values: changedValues(values.values, prefilled.current) },
        context,
        options,
      );
    return withChangedOnly;
  }, [currentYear, locale]);

  const form = useForm<ClientKpisInput, unknown, ClientKpisValues>({
    resolver,
    defaultValues: {
      companyId,
      periodYear: initialYear,
      values: prefilled.current,
      locale,
    },
  });
  const year = form.watch("periodYear") ?? initialYear;

  const [saveResult, dispatchSave, saving] = useActionState<SaveResult | null, unknown>(
    saveClientKpis,
    null,
  );
  const [clearResult, setClearResult] = useState<ClearResult | null>(null);
  const [last, setLast] = useState<"save" | "clear" | null>(null);
  const outcome = last === "clear" ? clearResult : last === "save" ? saveResult : null;

  useEffect(() => {
    if (saveResult?.ok) router.refresh();
  }, [saveResult, router]);

  // Fresh rows after a refresh (a save landed, a clear landed, research finished) refill the
  // untouched fields; a field the client is still editing keeps its value.
  // `rowsKey` stands for `rows`; the other inputs are stable for the life of the form.
  const rowsKey = rows.map((row) => `${row.id}:${row.updatedAt}`).join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: rowsKey is the row signature
  useEffect(() => {
    prefilled.current = prefillValues(fields, rows, year);
    form.reset(
      { companyId, periodYear: year, values: prefilled.current, locale },
      { keepDirtyValues: true },
    );
  }, [rowsKey]);

  const changeYear = (next: number) => {
    prefilled.current = prefillValues(fields, rows, next);
    form.reset({ companyId, periodYear: next, values: prefilled.current, locale });
  };

  const submit = form.handleSubmit((values) => {
    setLast("save");
    startTransition(() =>
      dispatchSave({ companyId, periodYear: values.periodYear, values: values.values, locale }),
    );
  });

  const newer = newerYearsThan(rows, year);
  const newerByYear = [...new Set(newer.map((entry) => entry.year))]
    .sort((a, b) => b - a)
    .map((newerYear) => ({
      year: newerYear,
      names: newer
        .filter((entry) => entry.year === newerYear)
        .map((entry) => fields.find((field) => field.key === entry.key)?.name ?? entry.key),
    }));
  const { errors } = form.formState;

  return (
    <form
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-6"
      aria-busy={saving}
      data-kpi-form
      data-year={year}
    >
      {outcome && !outcome.ok ? (
        <Alert variant="destructive" role="alert" data-error={outcome.error}>
          <OctagonXIcon aria-hidden="true" />
          <AlertTitle>{errorsT(outcome.error)}</AlertTitle>
        </Alert>
      ) : null}
      {outcome?.ok ? (
        <p
          className="text-sm"
          role="status"
          data-kpis-saved={last === "save" ? outcome.data.benchmarkQueued : undefined}
          data-kpi-cleared={last === "clear" ? outcome.data.benchmarkQueued : undefined}
        >
          {last === "clear"
            ? outcome.data.benchmarkQueued
              ? t("cleared")
              : t("clearedNotQueued")
            : outcome.data.benchmarkQueued
              ? t("saved")
              : t("savedNotQueued")}
        </p>
      ) : null}

      <Controller
        control={form.control}
        name="periodYear"
        render={({ field, fieldState }) => (
          <Field className="max-w-xs" data-invalid={fieldState.invalid ? true : undefined}>
            <FieldLabel htmlFor="self-assessment-year">{t("year")}</FieldLabel>
            <Select
              value={String(field.value ?? initialYear)}
              onValueChange={(value) => changeYear(Number(value))}
            >
              <SelectTrigger
                id="self-assessment-year"
                aria-invalid={fieldState.invalid ? true : undefined}
                aria-describedby={
                  fieldState.invalid ? "self-assessment-year-error" : "self-assessment-year-hint"
                }
                className="w-full"
                data-year-picker
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {String(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription id="self-assessment-year-hint">{t("yearHint")}</FieldDescription>
            <FieldError id="self-assessment-year-error">
              {issueMessage(fieldState.error?.message, v)}
            </FieldError>
          </Field>
        )}
      />

      <FieldGroup className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {fields.map((definition) => {
          const row = rows.find(
            (entry) => entry.kpiKey === definition.key && entry.periodYear === year,
          );
          const source = row?.source ?? "none";
          const error = errors.values?.[definition.key];
          const inputId = `self-assessment-${definition.key}`;
          const describedBy = [
            definition.description ? `${inputId}-description` : null,
            `${inputId}-source`,
            error ? `${inputId}-error` : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <Field
              key={definition.key}
              data-invalid={error ? true : undefined}
              data-kpi-field={definition.key}
              data-source={source}
            >
              <FieldLabel htmlFor={inputId}>{definition.name}</FieldLabel>
              {definition.description ? (
                <FieldDescription id={`${inputId}-description`}>
                  {definition.description}
                </FieldDescription>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {definition.format === "yesNo" ? (
                  <Controller
                    control={form.control}
                    name={`values.${definition.key}`}
                    render={({ field }) => (
                      <Select
                        value={
                          field.value === "" || field.value === null || field.value === undefined
                            ? UNSET
                            : String(field.value)
                        }
                        onValueChange={(value) => field.onChange(value === UNSET ? "" : value)}
                      >
                        <SelectTrigger
                          id={inputId}
                          aria-invalid={error ? true : undefined}
                          aria-describedby={describedBy}
                          className="w-40"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNSET}>{t("yesNo.unset")}</SelectItem>
                          <SelectItem value="1">{t("yesNo.yes")}</SelectItem>
                          <SelectItem value="0">{t("yesNo.no")}</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                ) : (
                  <Input
                    id={inputId}
                    type="text"
                    inputMode={definition.format === "integer" ? "numeric" : "decimal"}
                    autoComplete="off"
                    className="w-40 tabular-nums"
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    {...form.register(`values.${definition.key}`)}
                  />
                )}
                <span className="text-muted-foreground text-xs">{definition.unit}</span>
                {source === "client" ? (
                  <ClearButton
                    companyId={companyId}
                    kpiKey={definition.key}
                    kpiName={definition.name}
                    periodYear={year}
                    onResult={(result) => {
                      setLast("clear");
                      setClearResult(result);
                    }}
                  />
                ) : null}
              </div>
              <FieldDescription id={`${inputId}-source`} data-source-caption={source}>
                {t(`source.${source}`)}
              </FieldDescription>
              <FieldError id={`${inputId}-error`}>{issueMessage(error?.message, v)}</FieldError>
            </Field>
          );
        })}
      </FieldGroup>

      {newerByYear.length > 0 ? (
        <p className="max-w-prose text-muted-foreground text-sm" data-older-year-hint>
          {t("olderYearIntro")}{" "}
          {newerByYear
            .map((entry) =>
              t("olderYearApplies", { kpis: format.list(entry.names), year: String(entry.year) }),
            )
            .join(" ")}
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={saving}>
          {saving ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}

type ClearButtonProps = {
  readonly companyId: string;
  readonly kpiKey: KpiKey;
  readonly kpiName: string;
  readonly periodYear: number;
  readonly onResult: (result: ClearResult) => void;
};

/** The per field clear button (AC-7): its own action state, refreshes on success, reports every result to the form. Browser. */
function ClearButton({ companyId, kpiKey, kpiName, periodYear, onResult }: ClearButtonProps) {
  const t = useTranslations("selfAssessment");
  const locale = useLocale();
  const router = useRouter();
  const [result, dispatch, pending] = useActionState<ClearResult | null, unknown>(
    clearClientKpi,
    null,
  );

  // `onResult` is a fresh closure on every render; the result identity is the signal.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onResult is intentionally omitted
  useEffect(() => {
    if (!result) return;
    onResult(result);
    if (result.ok) router.refresh();
  }, [result, router]);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pending}
      aria-label={t("clear", { kpi: kpiName })}
      data-clear-kpi={kpiKey}
      onClick={() => startTransition(() => dispatch({ companyId, kpiKey, periodYear, locale }))}
    >
      <XIcon data-icon="inline-start" aria-hidden="true" />
      {pending ? t("clearing") : t("clearShort")}
    </Button>
  );
}
