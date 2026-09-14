import { z } from "zod";
import { PEER_LIMIT } from "@/lib/research/peer-schema";

/**
 * What Claude returns for one peer search (spec 0022, AC-8): one verdict per peer and rate,
 * saying whether the cited page states that figure for that year, how sure it is and which
 * sources carry it. The value itself is never asked for: the conversion to per million hours is
 * code's job (AC-8). Pure schema.
 */
export const peerVerdictSchema = z.object({
  /** The peer's index in the list as given, 0 based. */
  peerIndex: z
    .number()
    .int()
    .min(0)
    .max(PEER_LIMIT - 1),
  kpiKey: z.enum(["ltifr", "trifr"]),
  /** True only when the cited page states this rate for this company and year. */
  supported: z.boolean(),
  /** The reporting year the page states, null when it names none. */
  periodYear: z.number().int().min(2000).max(2100).nullable(),
  confidence: z.number().min(0).max(1),
  /** Indexes into the rate's sources (0 based, in the order given) that support the figure. */
  sourceIndexes: z.array(z.number().int().min(0)).max(10),
  reason: z.string().max(300).optional(),
});
export type PeerVerdict = z.infer<typeof peerVerdictSchema>;

/** At most two verdicts per peer (LTIFR and TRIFR). */
export const peerValidationSchema = z.object({
  verdicts: z.array(peerVerdictSchema).max(PEER_LIMIT * 2),
});
export type PeerValidation = z.infer<typeof peerValidationSchema>;
