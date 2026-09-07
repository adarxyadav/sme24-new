import { z } from "zod";

/**
 * What Claude returns for one peer proposal (spec 0012, AC-2): candidate company names with a
 * reason each, never a number. Pure schema.
 */
export const peerCandidateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  legalName: z.string().trim().max(200).nullable(),
  /** A bare host such as `example.ch`, or null when the model is not sure. */
  website: z.string().trim().max(200).nullable(),
  reason: z.string().trim().max(200),
});
export type PeerCandidate = z.infer<typeof peerCandidateSchema>;

export const peerProposalSchema = z.object({
  candidates: z.array(peerCandidateSchema).max(10),
});
export type PeerProposal = z.infer<typeof peerProposalSchema>;
