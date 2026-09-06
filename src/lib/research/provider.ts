/**
 * The research provider interface (spec 0007, API surface): what the `research-company` task
 * needs from a web research service, so Parallel and the fixture are interchangeable and a
 * second provider is a file in this folder. Task only. Pure types plus two error classes.
 */

export type ProviderInput = {
  readonly name: string;
  readonly legalName: string | null;
  readonly website: string | null;
  readonly country: string;
};

/** A JSON schema object (`type: "object"`, string properties) the provider fills field by field. */
export type ProviderOutputSchema = {
  readonly type: "object";
  readonly properties: Readonly<
    Record<string, { readonly type: "string"; readonly description: string }>
  >;
  readonly required: readonly string[];
  readonly additionalProperties: false;
};

export type ProviderCitation = {
  readonly url: string;
  readonly title: string;
  readonly excerpts: readonly string[];
};

export type BasisConfidence = "low" | "medium" | "high";

/** What the provider cites for one field: its citations, its reasoning and how sure it is. */
export type ProviderBasis = {
  readonly field: string;
  readonly citations: readonly ProviderCitation[];
  readonly reasoning: string;
  readonly confidence: BasisConfidence | null;
};

export type ProviderRunStatus = "running" | "done" | "failed";

export type ProviderResult = {
  /** The flat output, one string per schema field. */
  readonly fields: Readonly<Record<string, string>>;
  readonly basis: readonly ProviderBasis[];
  /** The provider's short free text summary, when it gives one. */
  readonly text: string | null;
  /** Which processor answered (`core` for Parallel, `fixture` locally). */
  readonly processor: "core" | "fixture";
};

export type ResearchProvider = {
  readonly createRun: (
    input: ProviderInput,
    schema: ProviderOutputSchema,
  ) => Promise<{ providerRunId: string }>;
  readonly getRun: (providerRunId: string) => Promise<{ status: ProviderRunStatus }>;
  readonly getResult: (providerRunId: string) => Promise<ProviderResult>;
};

/** A 4xx other than 429 on creating the run, or a run the provider reports as failed: not retried (AC-10). */
export class ProviderRejectedError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderRejectedError";
    this.status = status;
  }
}

/** A network error, a 429 or a 5xx: thrown so Trigger.dev retries and resumes the stored run (AC-10). */
export class ProviderUnavailableError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ProviderUnavailableError";
    this.status = status;
  }
}

/** The prior confidence a basis level gives a value (value sourcing: low 0.3, medium 0.6, high 0.9). */
export const BASIS_PRIOR: Record<BasisConfidence, number> = { low: 0.3, medium: 0.6, high: 0.9 };

/** The prior of a basis confidence, `low` when the provider gave none. Pure. */
export function basisPrior(confidence: BasisConfidence | null): number {
  return BASIS_PRIOR[confidence ?? "low"];
}
