import Parallel, { APIConnectionError, APIError } from "parallel-web";
import {
  type BasisConfidence,
  type ProviderBasis,
  type ProviderInput,
  type ProviderOutputSchema,
  ProviderRejectedError,
  type ProviderResult,
  type ProviderRunStatus,
  ProviderUnavailableError,
  type ResearchProvider,
} from "./provider";

/**
 * The Parallel Task API behind the provider interface (spec 0007, AC-4, AC-10, AC-13): one task
 * run per research run on the `core` processor with the flat output schema, polled through
 * `retrieve`, the result read once through `result`. The input carries the company name, legal
 * name, website and country only. A 429, 5xx or network error becomes `ProviderUnavailableError`
 * (retried); any other 4xx becomes `ProviderRejectedError` (aborted). Task only.
 */

/** The processor every run uses (value sourcing: constant `core`). */
export const PARALLEL_PROCESSOR = "core";

/** The statuses Parallel reports mapped to the three the task understands. */
const STATUS_MAP: Record<string, ProviderRunStatus> = {
  queued: "running",
  action_required: "running",
  running: "running",
  cancelling: "running",
  completed: "done",
  failed: "failed",
  cancelled: "failed",
};

const CONFIDENCE_LEVELS: readonly BasisConfidence[] = ["low", "medium", "high"];

/** The task input Parallel sees: public company data and the research objective, nothing else (AC-13). Pure. */
export function buildParallelInput(input: ProviderInput): Record<string, string> {
  return {
    objective:
      "Research the company's published occupational health and safety figures (sustainability, ESG, annual and safety reports, press releases, certification registers) for the latest three reporting years, and its registered company facts.",
    company_name: input.name,
    legal_name: input.legalName ?? "",
    website: input.website ?? "",
    country: input.country,
  };
}

/** Maps one Parallel basis entry to the provider shape. Pure. */
export function mapBasis(entry: {
  field: string;
  reasoning: string;
  citations?: Array<{ url: string; title?: string | null; excerpts?: string[] | null }>;
  confidence?: string | null;
}): ProviderBasis {
  const confidence = CONFIDENCE_LEVELS.find((level) => level === entry.confidence) ?? null;
  return {
    field: entry.field,
    reasoning: entry.reasoning,
    confidence,
    citations: (entry.citations ?? []).map((citation) => ({
      url: citation.url,
      title: citation.title ?? "",
      excerpts: citation.excerpts ?? [],
    })),
  };
}

/** Turns an SDK error into the two provider classes (AC-10). Pure. */
export function classifyParallelError(
  error: unknown,
): ProviderRejectedError | ProviderUnavailableError {
  if (error instanceof APIConnectionError) {
    return new ProviderUnavailableError(`network: ${error.message}`, null);
  }
  if (error instanceof APIError) {
    const status = typeof error.status === "number" ? error.status : null;
    if (status === 429 || (status !== null && status >= 500)) {
      return new ProviderUnavailableError(`parallel answered ${status}`, status);
    }
    return new ProviderRejectedError(`parallel refused the request (${status ?? "?"})`, status);
  }
  return new ProviderUnavailableError(error instanceof Error ? error.message : String(error), null);
}

/** Creates the Parallel provider on the official SDK. */
export function createParallelProvider(apiKey: string): ResearchProvider {
  const client = new Parallel({ apiKey, maxRetries: 0 });
  const guard = async <T>(call: () => Promise<T>): Promise<T> => {
    try {
      return await call();
    } catch (error) {
      throw classifyParallelError(error);
    }
  };
  return {
    createRun: async (input: ProviderInput, schema: ProviderOutputSchema) => {
      const run = await guard(() =>
        client.taskRun.create({
          input: buildParallelInput(input),
          processor: PARALLEL_PROCESSOR,
          task_spec: { output_schema: { type: "json", json_schema: schema } },
        }),
      );
      return { providerRunId: run.run_id };
    },
    getRun: async (providerRunId: string) => {
      const run = await guard(() => client.taskRun.retrieve(providerRunId));
      return { status: STATUS_MAP[run.status] ?? "running" };
    },
    getResult: async (providerRunId: string): Promise<ProviderResult> => {
      const result = await guard(() => client.taskRun.result(providerRunId, { timeout: 30 }));
      if (result.output.type !== "json") {
        throw new ProviderRejectedError("parallel returned a text output for a json schema", null);
      }
      const content = result.output.content;
      const fields = Object.fromEntries(
        Object.entries(content).map(([key, value]) => [
          key,
          typeof value === "string"
            ? value
            : value === null || value === undefined
              ? ""
              : String(value),
        ]),
      );
      return {
        fields,
        basis: result.output.basis.map(mapBasis),
        text: typeof fields.summary === "string" && fields.summary !== "" ? fields.summary : null,
        processor: "core",
      };
    },
  };
}
