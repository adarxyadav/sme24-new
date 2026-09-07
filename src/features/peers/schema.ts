import { z } from "zod";
import { SIZE_BANDS } from "@/features/benchmark/catalogue";
import { normalizeWebsite } from "@/features/research/schema";
import { MAX_PEERS_PER_SET, PEER_PROPOSAL_COUNT, PEER_STATUSES } from "./catalogue";

/**
 * The peers feature's boundary schemas (spec 0012): the ops list filters, the hand added peer,
 * the per peer actions, the research batch and the proposal request. The same schemas type the
 * forms. Pure, runs anywhere.
 */

/** The select value that lifts a filter. */
export const ALL = "all";

/** One of the 21 NOGA section letters (`PEER_SECTIONS`), as a pattern so the tuple type stays out of the schema. */
const sectionField = z.string().regex(/^[A-U]$/, "sectionInvalid");
const sizeBandField = z.enum(SIZE_BANDS, { error: "sizeBandInvalid" });

/** The `/admin/peers` query parameters: section, band and status, each lifted by `all`. */
export const peerFiltersSchema = z.object({
  section: z
    .string()
    .regex(/^([A-U]|all)$/)
    .catch(ALL),
  sizeBand: z.enum([...SIZE_BANDS, ALL]).catch(ALL),
  status: z.enum([...PEER_STATUSES, ALL]).catch(ALL),
});
export type PeerFilters = z.infer<typeof peerFiltersSchema>;

const websiteField = z
  .string()
  .trim()
  .max(500, "websiteInvalid")
  .nullish()
  .transform((value, context) => {
    if (!value) return null;
    const normalised = normalizeWebsite(value);
    if (normalised === null) {
      context.addIssue({ code: "custom", message: "websiteInvalid" });
      return z.NEVER;
    }
    return normalised;
  });

/** A peer ops add by hand (AC-1): the company, its section and its band. */
export const addPeerSchema = z.object({
  name: z.string().trim().min(2, "nameShort").max(200, "nameLong"),
  legalName: z
    .string()
    .trim()
    .max(200, "legalNameLong")
    .nullish()
    .transform((value) => (value ? value : null)),
  website: websiteField,
  section: sectionField,
  sizeBand: sizeBandField,
  locale: z.string().optional(),
});
export type AddPeerInput = z.input<typeof addPeerSchema>;
export type AddPeerValues = z.output<typeof addPeerSchema>;

/** One peer by id: approve, retire, rerun. */
export const peerIdSchema = z.object({ peerId: z.uuid(), locale: z.string().optional() });
export type PeerIdInput = z.input<typeof peerIdSchema>;

/** A rejection with its optional reason, kept so the model does not propose the name again. */
export const rejectPeerSchema = z.object({
  peerId: z.uuid(),
  reason: z
    .string()
    .trim()
    .max(500, "reasonLong")
    .nullish()
    .transform((value) => (value ? value : null)),
  locale: z.string().optional(),
});
export type RejectPeerInput = z.input<typeof rejectPeerSchema>;
export type RejectPeerValues = z.output<typeof rejectPeerSchema>;

/** The research batch (AC-4): the peers ops confirmed, a request the action re reads. */
export const researchPeersSchema = z.object({
  peerIds: z.array(z.uuid()).min(1).max(50),
  locale: z.string().optional(),
});
export type ResearchPeersInput = z.input<typeof researchPeersSchema>;

/** A proposal request (AC-2): the section, the band and how many candidates to ask for. */
export const proposePeersSchema = z.object({
  section: sectionField,
  sizeBand: sizeBandField,
  count: z.coerce
    .number({ error: "countInvalid" })
    .int("countInvalid")
    .min(1, "countInvalid")
    .max(MAX_PEERS_PER_SET, "countInvalid")
    .default(PEER_PROPOSAL_COUNT),
  locale: z.string().optional(),
});
export type ProposePeersInput = z.input<typeof proposePeersSchema>;
export type ProposePeersValues = z.output<typeof proposePeersSchema>;

/** Builds the query string of the list page from filters, dropping the defaults. Pure. */
export function peerListQuery(filters: Partial<PeerFilters>): string {
  const params = new URLSearchParams();
  if (filters.section && filters.section !== ALL) params.set("section", filters.section);
  if (filters.sizeBand && filters.sizeBand !== ALL) params.set("sizeBand", filters.sizeBand);
  if (filters.status && filters.status !== ALL) params.set("status", filters.status);
  const query = params.toString();
  return query ? `?${query}` : "";
}
