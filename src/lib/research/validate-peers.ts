import { structuredOutput } from "@/lib/ai/gateway";
import {
  PEER_PROMPT_VERSION,
  type PeerPromptCompany,
  peerValidationPrompt,
  peerValidationSystemPrompt,
} from "@/lib/ai/prompts/peer-validation";
import { type PeerVerdict, peerValidationSchema } from "@/lib/ai/schemas/peer-validation";
import { log } from "@/lib/logger";
import type { PeerCompany } from "./peer-schema";

/**
 * The peer validation pass (spec 0022, AC-8): one Claude call over the peers the provider returned
 * and the pages it cited, answering per peer and rate whether that page states the figure. The
 * value is never asked for, the conversion to per million hours is code's (AC-8). When the call
 * still fails after the SDK's retries this returns null, so the task keeps the peers with the code
 * converted values at a capped confidence and records `validation: skipped`. Task only.
 */

export type PeerVerdictKey = `${number}:${"ltifr" | "trifr"}`;

export type PeerValidationOutcome = {
  /** Keyed by `<peerIndex>:<kpiKey>`, the shape `verdictKey` builds. */
  readonly verdicts: ReadonlyMap<PeerVerdictKey, PeerVerdict>;
  readonly promptVersion: string;
};

export type ValidatePeersInput = {
  readonly company: PeerPromptCompany;
  readonly peers: readonly PeerCompany[];
  readonly apiKey: string | undefined;
  readonly onError: (error: unknown) => void;
};

/** The map key of one verdict: the peer's index in the list as given and the rate. Pure. */
export function verdictKey(peerIndex: number, kpiKey: "ltifr" | "trifr"): PeerVerdictKey {
  return `${peerIndex}:${kpiKey}`;
}

export async function validatePeers({
  company,
  peers,
  apiKey,
  onError,
}: ValidatePeersInput): Promise<PeerValidationOutcome | null> {
  if (!apiKey) {
    log.warn("peer validation skipped: AI_GATEWAY_API_KEY is not set");
    return null;
  }
  if (peers.length === 0) return { verdicts: new Map(), promptVersion: PEER_PROMPT_VERSION };
  try {
    const output = await structuredOutput({
      apiKey,
      schema: peerValidationSchema,
      system: peerValidationSystemPrompt(),
      prompt: peerValidationPrompt(company, peers),
    });
    const verdicts = new Map<PeerVerdictKey, PeerVerdict>();
    for (const verdict of output.verdicts) {
      verdicts.set(verdictKey(verdict.peerIndex, verdict.kpiKey), verdict);
    }
    return { verdicts, promptVersion: PEER_PROMPT_VERSION };
  } catch (error) {
    log.error("peer validation failed; keeping the code converted values", {
      reason: error instanceof Error ? error.message : String(error),
    });
    onError(error);
    return null;
  }
}
