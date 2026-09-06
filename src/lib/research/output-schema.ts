import { KPI_LIST, type KpiKey } from "@/features/research/catalogue";
import type { ProviderOutputSchema } from "./provider";

/**
 * The flat provider output schema built from the catalogue (spec 0007, Feature design):
 * `reporting_years`, then three string fields per KPI (`<key>_latest`, `<key>_previous`,
 * `<key>_two_years_prior`, each "value and year, or 'not found'"), then the company facts and a
 * summary. Flat string fields are what the provider cites per field. Pure.
 */

export const YEAR_SLOTS = ["latest", "previous", "two_years_prior"] as const;
export type YearSlot = (typeof YEAR_SLOTS)[number];

export const FACT_FIELDS = [
  "legal_name",
  "uid",
  "website",
  "industry_noga",
  "employees",
  "canton",
  "summary",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

const FACT_DESCRIPTIONS: Record<FactField, string> = {
  legal_name:
    "The registered legal name of the company as in the Swiss commercial register, or 'not found'.",
  uid: "The Swiss company identification number in the form CHE-123.456.789, or 'not found'.",
  website: "The company's main website, or 'not found'.",
  industry_noga:
    "The NOGA 2008 industry code of the main activity as 'dd' or 'dd.dd' (for example '23.61'), or 'not found'.",
  employees:
    "The number of employees (headcount or full time equivalents, say which) in the latest reporting year, or 'not found'.",
  canton:
    "The canton of the registered office as the two letter code (ZH, BE, VD, ...), or 'not found'.",
  summary:
    "Two or three sentences on the company's occupational health and safety reporting: which reports exist, which years, and how detailed the safety figures are.",
};

const SLOT_LABEL: Record<YearSlot, string> = {
  latest: "the latest reporting year",
  previous: "the reporting year before the latest",
  two_years_prior: "two reporting years before the latest",
};

/** The output field name of a KPI and year slot. Pure. */
export function kpiField(key: KpiKey, slot: YearSlot): string {
  return `${key}_${slot}`;
}

/** Builds the provider output schema from the catalogue. Pure. */
export function buildOutputSchema(): ProviderOutputSchema {
  const kpiProperties = Object.fromEntries(
    KPI_LIST.flatMap((kpi) =>
      YEAR_SLOTS.map((slot) => [
        kpiField(kpi.key, slot),
        {
          type: "string" as const,
          description: `${kpi.hint} Give the value for ${SLOT_LABEL[slot]} as 'value (unit), year', for example '2.4 per 1 000 000 hours, 2024', or 'not found'.`,
        },
      ]),
    ),
  );
  const factProperties = Object.fromEntries(
    FACT_FIELDS.map((field) => [
      field,
      { type: "string" as const, description: FACT_DESCRIPTIONS[field] },
    ]),
  );
  const properties = {
    reporting_years: {
      type: "string" as const,
      description:
        "The fiscal or reporting years for which safety figures were found, newest first, comma separated (for example '2024, 2023, 2022'), or 'not found'.",
    },
    ...kpiProperties,
    ...factProperties,
  };
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
