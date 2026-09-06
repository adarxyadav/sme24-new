import { KPI_LIST, YEARS_PER_RUN } from "@/features/research/catalogue";
import { FACT_FIELDS, kpiField, YEAR_SLOTS } from "./output-schema";
import type {
  ProviderBasis,
  ProviderInput,
  ProviderResult,
  ProviderRunStatus,
  ResearchProvider,
} from "./provider";
import { ProviderRejectedError, ProviderUnavailableError } from "./provider";

/**
 * The fixture provider (spec 0007, AC-12): pinned constants so the whole thread runs locally and
 * in Playwright without research credits. Any name gives a full result of eight KPIs for the
 * years current minus 1 to current minus 3 with five sources; a name containing `empty` gives an
 * empty result; a name containing `fail` throws a provider failure (case insensitive). Reports
 * done on the first poll. Task only.
 */

/** The fixed values per KPI for the latest year; earlier years step by `YEAR_STEP`. */
export const FIXTURE_VALUES = {
  ltifr: 2.4,
  trifr: 6.1,
  fatalities: 0,
  lost_days_per_incident: 12.5,
  accident_rate_per_1000_fte: 68,
  absenteeism_rate: 3.8,
  near_miss_rate: 14,
  iso_45001_certified: 1,
} as const;

/** How the value moves per year back in time (higher a year earlier for the "lower is better" KPIs). */
const YEAR_STEP = {
  ltifr: 0.3,
  trifr: 0.5,
  fatalities: 0,
  lost_days_per_incident: 0.5,
  accident_rate_per_1000_fte: 4,
  absenteeism_rate: 0.2,
  near_miss_rate: -1,
  iso_45001_certified: 0,
} as const;

export const FIXTURE_SOURCES = [
  { url: "https://www.example.ch/reports/sustainability-report", title: "Sustainability report" },
  { url: "https://www.example.ch/reports/annual-report", title: "Annual report" },
  {
    url: "https://www.example.ch/safety/health-and-safety-policy",
    title: "Health and safety policy",
  },
  { url: "https://www.example.ch/about/certifications", title: "Certifications" },
  { url: "https://www.zefix.ch/en/search/entity/list", title: "Zefix commercial register" },
] as const;

export const FIXTURE_FACTS = {
  legal_name: "Example Fixture AG",
  uid: "CHE-123.456.789",
  website: "https://www.example.ch",
  industry_noga: "23.61",
  employees: "420 employees (full time equivalents)",
  canton: "ZH",
  summary:
    "The company publishes a sustainability report each year with a health and safety chapter. Injury rates, absenteeism and near miss figures are reported for the last three years.",
} as const;

/** The fixture answers after about this long per step (two seconds), so the progress list is visible. */
export const FIXTURE_STEP_MS = 2_000;

export const FIXTURE_RUN_PREFIX = "fixture_";

/** True when the company name asks for the empty outcome. Pure. */
export function fixtureWantsEmpty(name: string): boolean {
  return /empty/i.test(name);
}

/** True when the company name asks for a provider failure. Pure. */
export function fixtureWantsFailure(name: string): boolean {
  return /fail/i.test(name);
}

/** The three reporting years the fixture reports: current minus 1 to current minus 3. Pure. */
export function fixtureYears(now = new Date()): readonly number[] {
  const current = now.getUTCFullYear();
  return Array.from({ length: YEARS_PER_RUN }, (_, index) => current - 1 - index);
}

/** The fixture value of a KPI for a year slot (0 latest, 1 previous, 2 two years prior). Pure. */
export function fixtureValue(key: keyof typeof FIXTURE_VALUES, slotIndex: number): number {
  const value = FIXTURE_VALUES[key] + YEAR_STEP[key] * slotIndex;
  return Math.round(value * 100) / 100;
}

/** The full fixture result for the given years. Pure. */
export function fixtureResult(years: readonly number[]): ProviderResult {
  const fields: Record<string, string> = {
    reporting_years: years.join(", "),
    ...FIXTURE_FACTS,
  };
  const basis: ProviderBasis[] = [];
  KPI_LIST.forEach((kpi, kpiIndex) => {
    YEAR_SLOTS.forEach((slot, slotIndex) => {
      const year = years[slotIndex];
      if (year === undefined) return;
      const field = kpiField(kpi.key, slot);
      const value = fixtureValue(kpi.key, slotIndex);
      const rendered = kpi.parse === "boolean" ? (value === 1 ? "yes" : "no") : String(value);
      fields[field] = `${rendered} (${kpi.unit}), ${year}`;
      const source = sourceAt(kpiIndex + slotIndex);
      basis.push({
        field,
        citations: [
          {
            url: source.url,
            title: source.title,
            excerpts: [`${kpi.key.replaceAll("_", " ")} ${year}: ${rendered} ${kpi.unit}.`],
          },
        ],
        reasoning: `Stated in the ${source.title.toLowerCase()} for ${year}.`,
        confidence: slotIndex === 0 ? "high" : "medium",
      });
    });
  });
  for (const fact of FACT_FIELDS) {
    const source = sourceAt(fact === "uid" ? 4 : 1);
    basis.push({
      field: fact,
      citations: [{ url: source.url, title: source.title, excerpts: [FIXTURE_FACTS[fact]] }],
      reasoning: `Stated in the ${source.title.toLowerCase()}.`,
      confidence: "high",
    });
  }
  return { fields, basis, text: FIXTURE_FACTS.summary, processor: "fixture" };
}

/** The empty fixture result: every field "not found", no sources. Pure. */
export function fixtureEmptyResult(): ProviderResult {
  const fields: Record<string, string> = { reporting_years: "not found" };
  for (const kpi of KPI_LIST) {
    for (const slot of YEAR_SLOTS) fields[kpiField(kpi.key, slot)] = "not found";
  }
  for (const fact of FACT_FIELDS) fields[fact] = "not found";
  return { fields, basis: [], text: null, processor: "fixture" };
}

/** A fixture source by index, wrapping around the five. Pure. */
function sourceAt(index: number): (typeof FIXTURE_SOURCES)[number] {
  return FIXTURE_SOURCES[index % FIXTURE_SOURCES.length] ?? FIXTURE_SOURCES[0];
}

const encode = (input: ProviderInput) => Buffer.from(input.name, "utf8").toString("base64url");
const decode = (providerRunId: string) =>
  Buffer.from(providerRunId.slice(FIXTURE_RUN_PREFIX.length), "base64url").toString("utf8");

/** Creates the fixture provider; `sleep` is injectable so tests skip the two second pauses. */
export function createFixtureProvider(
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): ResearchProvider {
  return {
    createRun: async (input) => {
      await sleep(FIXTURE_STEP_MS);
      if (fixtureWantsFailure(input.name)) {
        throw new ProviderUnavailableError("fixture: the provider is unavailable", 503);
      }
      return { providerRunId: `${FIXTURE_RUN_PREFIX}${encode(input)}` };
    },
    getRun: async (providerRunId): Promise<{ status: ProviderRunStatus }> => {
      await sleep(FIXTURE_STEP_MS);
      if (!providerRunId.startsWith(FIXTURE_RUN_PREFIX)) {
        throw new ProviderRejectedError("fixture: unknown run", 404);
      }
      return { status: "done" };
    },
    getResult: async (providerRunId) => {
      const name = decode(providerRunId);
      return fixtureWantsEmpty(name) ? fixtureEmptyResult() : fixtureResult(fixtureYears());
    },
  };
}
