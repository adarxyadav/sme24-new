import type { CompanyFacts } from "@/features/research/summary";
import { structuredOutput } from "@/lib/ai/gateway";
import {
  PROMPT_VERSION,
  type PromptCompany,
  type PromptFacts,
  researchValidationPrompt,
  researchValidationSystemPrompt,
} from "@/lib/ai/prompts/research-validation";
import { acceptedFacts, researchValidationSchema } from "@/lib/ai/schemas/research-validation";
import { log } from "@/lib/logger";
import type { Candidate } from "./candidates";
import type { Verdict } from "./resolve";

/**
 * The validation pass (spec 0007, AC-5): one Claude call over the candidates and their citations,
 * returning a verdict per field plus the accepted company facts. When the call still fails after
 * the SDK's retries, returns null so the task continues with the provider's values as parsed by
 * the catalogue rules (`validation` `skipped`) and reports the failure through `onError`. Task only.
 */

export type ValidationOutcome = {
  readonly verdicts: ReadonlyMap<string, Verdict>;
  readonly facts: CompanyFacts;
  readonly promptVersion: string;
};

export type ValidateResearchInput = {
  readonly company: PromptCompany;
  readonly candidates: readonly Candidate[];
  readonly facts: PromptFacts;
  readonly apiKey: string | undefined;
  readonly onError: (error: unknown) => void;
};

export async function validateResearch({
  company,
  candidates,
  facts,
  apiKey,
  onError,
}: ValidateResearchInput): Promise<ValidationOutcome | null> {
  if (!apiKey) {
    log.warn("research validation skipped: AI_GATEWAY_API_KEY is not set");
    return null;
  }
  if (candidates.length === 0 && Object.keys(facts).length === 0) {
    return { verdicts: new Map(), facts: {}, promptVersion: PROMPT_VERSION };
  }
  try {
    const output = await structuredOutput({
      apiKey,
      schema: researchValidationSchema,
      system: researchValidationSystemPrompt(),
      prompt: researchValidationPrompt(company, candidates, facts),
    });
    const verdicts = new Map<string, Verdict>();
    for (const value of output.values) {
      verdicts.set(value.field, {
        supported: value.supported,
        value: value.value,
        periodYear: value.periodYear,
        confidence: value.confidence,
        reason: value.reason,
      });
    }
    return { verdicts, facts: acceptedFacts(output.companyFacts), promptVersion: PROMPT_VERSION };
  } catch (error) {
    log.error("research validation failed; continuing with the provider's values", {
      reason: error instanceof Error ? error.message : String(error),
    });
    onError(error);
    return null;
  }
}
