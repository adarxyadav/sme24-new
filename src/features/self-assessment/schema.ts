import { z } from "zod";
import {
  inRange,
  KPI_CATALOGUE,
  KPI_KEYS,
  type KpiDefinition,
  type KpiKey,
  MIN_PERIOD_YEAR,
} from "@/features/research/catalogue";

/**
 * The self assessment boundary schemas (spec 0010, AC-4, AC-6): the client KPI form and the
 * clear request. The form schema is a factory so a test pins the current year; its output types
 * the form. Pure, runs anywhere.
 */

/** A typed figure: at most two decimals, a dot or a comma as the separator, an optional sign. */
const NUMBER_PATTERN = /^-?\d+(?:[.,]\d{1,2})?$/;

/**
 * One key aware field (AC-4): an empty string, whitespace or `null` becomes `undefined` (never
 * sent); a comma is normalised to a dot; the number must have at most two decimals, be a whole
 * number for an `integer` KPI, be `0` or `1` for a `yesNo` KPI and sit inside the catalogue range,
 * else the issue `valueInvalid`. Pure.
 */
export function kpiValueField(definition: KpiDefinition) {
  return z
    .union([z.string(), z.number()])
    .nullish()
    .transform((value, context) => {
      if (value === null || value === undefined) return undefined;
      const text = typeof value === "number" ? String(value) : value.trim();
      if (text === "") return undefined;
      const invalid = () => {
        context.addIssue({ code: "custom", message: "valueInvalid" });
        return z.NEVER;
      };
      if (!NUMBER_PATTERN.test(text)) return invalid();
      const parsed = Number(text.replace(",", "."));
      if (!Number.isFinite(parsed)) return invalid();
      if (definition.format === "integer" && !Number.isInteger(parsed)) return invalid();
      if (definition.format === "yesNo" && parsed !== 0 && parsed !== 1) return invalid();
      if (!inRange(definition.key, parsed)) return invalid();
      return parsed;
    });
}

type ValuesShape = { readonly [K in KpiKey]: ReturnType<typeof kpiValueField> };

/** One field per catalogue KPI, keyed so every issue lands on `['values', key]`. */
const valuesShape = Object.fromEntries(
  KPI_KEYS.map((key) => [key, kpiValueField(KPI_CATALOGUE[key])]),
) as ValuesShape;

/**
 * The client KPI form (AC-4): the company, one reporting year from 2000 to `currentYear` (else
 * `yearInvalid`), one value per KPI and the locale; at least one value must be set, else
 * `nothingToSave` on the year. Pure.
 */
export function clientKpisFormSchema(currentYear: number) {
  return z
    .object({
      companyId: z.uuid(),
      periodYear: z
        .number({ error: "yearInvalid" })
        .int({ error: "yearInvalid" })
        .min(MIN_PERIOD_YEAR, { error: "yearInvalid" })
        .max(currentYear, { error: "yearInvalid" }),
      values: z.object(valuesShape),
      locale: z.string().optional(),
    })
    .refine((form) => KPI_KEYS.some((key) => form.values[key] !== undefined), {
      message: "nothingToSave",
      path: ["periodYear"],
    });
}
export type ClientKpisFormSchema = ReturnType<typeof clientKpisFormSchema>;
export type ClientKpisInput = z.input<ClientKpisFormSchema>;
export type ClientKpisValues = z.output<ClientKpisFormSchema>;

/** The clear request (AC-6): one KPI of one company for one year. */
export const clearClientKpiSchema = z.object({
  companyId: z.uuid(),
  kpiKey: z.enum(KPI_KEYS),
  periodYear: z.number().int().min(MIN_PERIOD_YEAR),
  locale: z.string().optional(),
});
export type ClearClientKpiInput = z.input<typeof clearClientKpiSchema>;
