import { createGateway, generateText, Output } from "ai";
import type { z } from "zod";

/**
 * The one place that knows how the app talks to Claude (spec 0007, AC-5; spec 0001 Follow-up):
 * AI SDK v7 through the Vercel AI Gateway, `generateText` with `Output.object`. Tasks (and later
 * server code) call `structuredOutput`; nothing else imports `ai`.
 */

/** The model every AI call uses, as a gateway model string. */
export const AI_MODEL = "anthropic/claude-sonnet-5";

export type StructuredOutputInput<Schema extends z.ZodType> = {
  readonly apiKey: string;
  readonly schema: Schema;
  readonly system: string;
  readonly prompt: string;
  /**
   * The SDK retries transient errors this many times before the call throws (default 2). Spec
   * 0007 AC-5 ("when the call still fails after the SDK's retries") starts at this throw: the
   * research task then continues with the provider's values and marks the run `skipped`.
   */
  readonly maxRetries?: number;
};

/**
 * One structured call: temperature 0, the given Zod schema as the output contract. Throws when
 * the SDK's retries are exhausted or the output does not match the schema; callers decide what
 * a failure means. Task and server code.
 */
export async function structuredOutput<Schema extends z.ZodType>({
  apiKey,
  schema,
  system,
  prompt,
  maxRetries = 2,
}: StructuredOutputInput<Schema>): Promise<z.output<Schema>> {
  const gateway = createGateway({ apiKey });
  const { output } = await generateText({
    model: gateway(AI_MODEL),
    output: Output.object({ schema }),
    system,
    prompt,
    temperature: 0,
    maxRetries,
  });
  return output as z.output<Schema>;
}
