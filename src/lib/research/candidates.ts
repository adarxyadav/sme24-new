import { KPI_LIST, type KpiKey, parseKpiValue } from "@/features/research/catalogue";
import type { KpiSource } from "@/features/research/summary";
import { FACT_FIELDS, kpiField, YEAR_SLOTS, type YearSlot } from "./output-schema";
import type { BasisConfidence, ProviderBasis, ProviderResult } from "./provider";

/**
 * Turns a provider result into KPI candidates (spec 0007, AC-5, AC-6): one per KPI and year slot
 * whose field is not "not found", with the year parsed from the field text (fallback: the
 * position in `reporting_years`), the value parsed by the catalogue rule, the basis confidence
 * and the citations as `company_kpis.sources` entries. Pure; the validator and the skipped
 * fallback both start from this.
 */

export type Candidate = {
  readonly key: KpiKey;
  readonly slot: YearSlot;
  readonly field: string;
  readonly raw: string;
  /** The year parsed from the text, else the reporting year of the slot, else null. */
  readonly year: number | null;
  /** The value parsed by the catalogue rule in the source's own unit, or null when unparseable. */
  readonly value: number | null;
  readonly basisConfidence: BasisConfidence | null;
  readonly sources: readonly KpiSource[];
};

const NOT_FOUND = /^\s*(not found|nicht gefunden|n\/a|unknown)\s*\.?\s*$/i;

/** True when a provider field says nothing was found. Pure. */
export function isNotFound(raw: string | undefined): boolean {
  return raw === undefined || raw.trim() === "" || NOT_FOUND.test(raw);
}

/** The reporting years of a result, newest first, from the `reporting_years` field. Pure. */
export function parseReportingYears(raw: string | undefined): readonly number[] {
  if (isNotFound(raw)) return [];
  const years = [...(raw ?? "").matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return [...new Set(years)].sort((a, b) => b - a);
}

/** The year named in a field text: the last four digit year in it, or null. Pure. */
export function parseYear(raw: string): number | null {
  const years = [...raw.matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const last = years[years.length - 1];
  return last ?? null;
}

/**
 * The citations of one field as stored sources; a citation without an excerpt is kept with an
 * empty one. Only the first excerpt is stored on purpose: it is the one the source popover shows
 * and the one the validator is given, so keeping the rest would put text on the row that nothing
 * reads and nothing checked. Pure.
 */
export function sourcesOf(
  basis: readonly ProviderBasis[],
  field: string,
  retrievedAt: string,
): readonly KpiSource[] {
  const entry = basis.find((item) => item.field === field);
  if (!entry) return [];
  return entry.citations.map((citation) => ({
    url: citation.url.slice(0, 2000),
    title: (citation.title || citation.url).slice(0, 500),
    excerpt: (citation.excerpts[0] ?? "").slice(0, 2000),
    retrievedAt,
  }));
}

/** Every candidate of a result, in catalogue order then newest slot first. Pure. */
export function extractCandidates(
  result: ProviderResult,
  retrievedAt: string,
): readonly Candidate[] {
  const reportingYears = parseReportingYears(result.fields.reporting_years);
  return KPI_LIST.flatMap((kpi) =>
    YEAR_SLOTS.flatMap((slot, slotIndex) => {
      const field = kpiField(kpi.key, slot);
      const raw = result.fields[field];
      if (isNotFound(raw)) return [];
      const text = raw ?? "";
      const entry = result.basis.find((item) => item.field === field);
      return [
        {
          key: kpi.key,
          slot,
          field,
          raw: text,
          year: parseYear(text) ?? reportingYears[slotIndex] ?? null,
          value: parseKpiValue(kpi.parse, text),
          basisConfidence: entry?.confidence ?? null,
          sources: sourcesOf(result.basis, field, retrievedAt),
        },
      ];
    }),
  );
}

/** The raw company fact fields of a result (not found → undefined). Pure. */
export function extractFactFields(
  result: ProviderResult,
): Partial<Record<(typeof FACT_FIELDS)[number], string>> {
  return Object.fromEntries(
    FACT_FIELDS.flatMap((field) => {
      const raw = result.fields[field];
      return isNotFound(raw) ? [] : [[field, raw ?? ""]];
    }),
  );
}

/** The deduplicated source list of a result for `summary.sources`, at most 25. Pure. */
export function collectSources(
  result: ProviderResult,
  retrievedAt: string,
): ReadonlyArray<{ url: string; title: string; retrievedAt: string }> {
  const seen = new Map<string, { url: string; title: string; retrievedAt: string }>();
  for (const entry of result.basis) {
    for (const citation of entry.citations) {
      if (seen.has(citation.url) || seen.size >= 25) continue;
      seen.set(citation.url, {
        url: citation.url.slice(0, 2000),
        title: (citation.title || citation.url).slice(0, 500),
        retrievedAt,
      });
    }
  }
  return [...seen.values()];
}
