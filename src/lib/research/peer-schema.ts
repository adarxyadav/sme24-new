import { z } from "zod";
import { countryName } from "@/lib/countries";

/**
 * The peer search contract (spec 0022, AC-6, AC-8): what the provider is asked for, the JSON
 * schema it fills, the Zod parser its answer is read through, and the unit conversion to per
 * million hours worked. Pure, runs anywhere; the provider calls live in `parallel.ts` and
 * `fixture.ts`.
 */

/** What the `research-peers` task tells the provider about the client company (AC-5). */
export type PeerSearchInput = {
  readonly companyName: string;
  /** The NOGA/NACE section letter A to U of the client company. */
  readonly section: string;
  /** The English name of that section, so the objective reads as a sentence. */
  readonly sectionName: string;
  /** The client's ISO 3166 alpha 2 country: the ladder's first rung. */
  readonly country: string;
  /** Every country of the client's region, the ladder's second rung (`regionCountriesOf`). */
  readonly regionCountries: readonly string[];
  /** How many peers to aim for, and the fewest that make a comparison (AC-5: 8 and 3). */
  readonly targetPeers: number;
  readonly minimumPeers: number;
};

/** The three units a peer's rate may be printed in; anything else is `unsupported` (AC-8). */
export const PEER_UNITS = ["per_million_hours", "per_200k_hours", "per_100_workers"] as const;
export type PeerUnit = (typeof PEER_UNITS)[number];

/** How many peers the provider may return at most (AC-6). */
export const PEER_LIMIT = 8;

/**
 * What one printed rate converts by to reach per million hours worked (AC-8): a rate per 200 000
 * hours and a rate per 100 workers (200 000 hours being 100 workers of a 2 000 hour year) are
 * both the same figure at a fifth of the scale.
 */
export const PEER_UNIT_FACTOR: Record<PeerUnit, number> = {
  per_million_hours: 1,
  per_200k_hours: 5,
  per_100_workers: 5,
};

/** True when the string is one of the three units the model supports. Pure. */
export function isPeerUnit(value: unknown): value is PeerUnit {
  return typeof value === "string" && (PEER_UNITS as readonly string[]).includes(value);
}

/**
 * The value per million hours worked, computed in code from the printed value and the unit enum
 * (AC-8, never from the provider's own arithmetic); `null` when the unit is outside the three, so
 * the caller drops that rate as `unsupported`. Pure.
 */
export function valuePerMillionHours(value: number, unit: string): number | null {
  if (!isPeerUnit(unit) || !Number.isFinite(value) || value < 0) return null;
  return roundRate(value * PEER_UNIT_FACTOR[unit]);
}

/** Rates are stored to three decimals: five times a printed 0.123 is not 0.6149999999999999. Pure. */
function roundRate(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** One published rate of one peer, as printed on the cited page (AC-6). */
export const peerRateSchema = z.object({
  /** The value exactly as the source prints it, before any conversion. */
  value: z.number().min(0).max(10_000),
  unit: z.string().min(1).max(40),
  periodYear: z.number().int().min(2000).max(2100),
  sourceUrl: z.string().min(1).max(2000),
  sourceTitle: z.string().max(300).nullable(),
  /** Which population the rate counts, when the page says (AC-6: employees only is preferred). */
  basis: z.enum(["employees", "employees_and_contractors"]).nullable(),
});
export type PeerRate = z.infer<typeof peerRateSchema>;

export const peerCompanySchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().max(2000).nullable(),
  /** ISO 3166 alpha 2, the catalogue `companies.country` uses. */
  country: z.string().length(2),
  headcount: z.number().int().min(1).max(10_000_000).nullable(),
  headcountYear: z.number().int().min(2000).max(2100).nullable(),
  ltifr: peerRateSchema.nullable(),
  trifr: peerRateSchema.nullable(),
});
export type PeerCompany = z.infer<typeof peerCompanySchema>;

/** What a peer run answers: at most eight companies of the client's section (AC-6). */
export const peerSearchResultSchema = z.object({
  peers: z.array(peerCompanySchema).max(PEER_LIMIT),
});
export type PeerSearchResult = z.infer<typeof peerSearchResultSchema>;

/**
 * The JSON schema the provider fills for a peer run. Unlike the client run's flat string fields
 * (`output-schema.ts`), a peer run answers one array, so this shape is its own and the provider
 * interface takes it as `PeerOutputSchema`.
 */
export type PeerOutputSchema = {
  readonly type: "object";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

const RATE_SCHEMA = (rate: "LTIFR" | "TRIFR", description: string) => ({
  type: ["object", "null"],
  description,
  properties: {
    value: {
      type: "number",
      description: `The ${rate} exactly as the source prints it, before any conversion.`,
    },
    unit: {
      type: "string",
      enum: [...PEER_UNITS],
      description:
        "The denominator the source prints: 'per_million_hours' for a rate per 1 000 000 hours worked, 'per_200k_hours' for a rate per 200 000 hours worked, 'per_100_workers' for a rate per 100 employees or full time equivalents. Never convert the value yourself.",
    },
    periodYear: { type: "integer", description: "The reporting year the rate covers." },
    sourceUrl: { type: "string", description: "The page the rate is printed on." },
    sourceTitle: { type: ["string", "null"], description: "The title of that page." },
    basis: {
      type: ["string", "null"],
      enum: ["employees", "employees_and_contractors", null],
      description:
        "Whom the rate counts: 'employees' when it covers the company's own employees only, 'employees_and_contractors' when contractors are included, null when the page does not say.",
    },
  },
  required: ["value", "unit", "periodYear", "sourceUrl", "sourceTitle", "basis"],
  additionalProperties: false,
});

/** The peer output schema of AC-6: up to eight companies, each with its two rates. Pure. */
export function buildPeerOutputSchema(): PeerOutputSchema {
  return {
    type: "object",
    properties: {
      peers: {
        type: "array",
        // `maxItems` is not among the keywords Parallel's schema validator accepts: sending it
        // answers 422 before the search starts, which aborted every peer run (spec 0022). The cap
        // is stated in the description instead and enforced in code by `parsePeerContent`.
        description: `At most ${PEER_LIMIT} companies, each with at least one published injury rate. Never return more than ${PEER_LIMIT}.`,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "The company's name." },
            website: { type: ["string", "null"], description: "Its main website, or null." },
            country: {
              type: "string",
              description:
                "The ISO 3166 alpha 2 code of the country the company is headquartered in (for example 'DE').",
            },
            headcount: {
              type: ["integer", "null"],
              description:
                "Its number of employees or full time equivalents in the reporting year, or null.",
            },
            headcountYear: {
              type: ["integer", "null"],
              description: "The year that headcount is stated for, or null.",
            },
            ltifr: RATE_SCHEMA(
              "LTIFR",
              "The lost time injury frequency rate as published, or null when the company does not publish one.",
            ),
            trifr: RATE_SCHEMA(
              "TRIFR",
              "The total recordable injury frequency rate as published, or null when the company does not publish one.",
            ),
          },
          required: ["name", "website", "country", "headcount", "headcountYear", "ltifr", "trifr"],
          additionalProperties: false,
        },
      },
    },
    required: ["peers"],
    additionalProperties: false,
  };
}

/**
 * The research objective of a peer run (AC-6): the same section, the country first, then the
 * region, then anywhere, and employees only figures preferred. Nothing here names one country
 * other than the client's own (AC-3). Pure.
 */
export function buildPeerObjective(input: PeerSearchInput): string {
  const home = countryName(input.country, "en");
  const region = input.regionCountries
    .filter((code) => code !== input.country)
    .map((code) => countryName(code, "en"))
    .join(", ");
  return [
    `Find up to ${input.targetPeers} companies (at least ${input.minimumPeers}) that publish their occupational injury frequency rates and operate in the same industry as ${input.companyName}: NACE section ${input.section}, ${input.sectionName}.`,
    `Prefer companies headquartered in ${home}; then companies headquartered in ${region || "the same region"}; then companies anywhere.`,
    "Take the figures from the companies' own published sustainability, ESG, annual or safety reports for the latest reporting year each one states, and give the page each figure is printed on.",
    "Report the lost time injury frequency rate (LTIFR) and the total recordable injury frequency rate (TRIFR) exactly as printed, with the denominator the report uses, and never convert a value yourself.",
    "Prefer a figure that covers the company's own employees only over one that includes contractors, and say which the page states.",
    `Do not include ${input.companyName} itself, and do not include a company that publishes neither rate.`,
  ].join(" ");
}
