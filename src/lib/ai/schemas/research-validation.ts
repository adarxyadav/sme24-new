import { z } from "zod";
import { KPI_KEYS } from "@/features/research/catalogue";
import { type CompanyFacts, companyFactsSchemaFor } from "@/features/research/summary";

/**
 * What Claude returns for one research result (spec 0007, AC-5): at most 24 checked values (the
 * eight KPIs times three years), each already converted to the catalogue unit, plus the
 * normalised company facts. Pure schema.
 */
export const validatedValueSchema = z.object({
  /** The provider output field the value came from (`ltifr_latest`). */
  field: z.string().min(1).max(80),
  key: z.enum(KPI_KEYS),
  periodYear: z.number().int().nullable(),
  /** The value in the catalogue unit, null when the text could not be parsed or converted. */
  value: z.number().nullable(),
  /** The unit the source used, as written there. */
  sourceUnit: z.string().max(80),
  confidence: z.number().min(0).max(1),
  /** True only when the cited excerpt states this value for this year. */
  supported: z.boolean(),
  reason: z.string().max(300).optional(),
  /** Indexes into the field's citations that support the value. */
  sourceIndexes: z.array(z.number().int().min(0)).max(10),
});
export type ValidatedValue = z.infer<typeof validatedValueSchema>;

export const researchValidationSchema = z.object({
  values: z.array(validatedValueSchema).max(24),
  companyFacts: z.object({
    legalName: z.string().max(200).nullable(),
    uid: z.string().max(20).nullable(),
    industryCode: z.string().max(10).nullable(),
    employeesCount: z.number().int().nullable(),
    canton: z.string().max(2).nullable(),
  }),
});
export type ResearchValidation = z.infer<typeof researchValidationSchema>;

/**
 * The facts Claude returned that pass the country's rules, the rest dropped one by one (spec
 * 0022, AC-3): the register identifier is held to the Swiss shape only when the company's country
 * is `CH`, and a canton is kept only there. Pure.
 */
export function acceptedFacts(facts: ResearchValidation["companyFacts"], country: string) {
  const schema = companyFactsSchemaFor(country);
  const shape: Readonly<Record<string, unknown>> = schema.shape;
  const candidate = Object.entries(facts).filter(
    ([key, value]) => value !== null && value !== "" && key in shape,
  );
  return Object.fromEntries(
    candidate.filter(([key, value]) => schema.safeParse({ [key]: value }).success),
  ) as CompanyFacts;
}
