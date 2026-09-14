import { z } from "zod";
import { PACKAGE_KEYS } from "@/features/marketing/packages";
import { KPI_KEYS } from "@/features/research/catalogue";
import { PEER_RUNGS } from "@/features/research/summary";

/**
 * The snapshot block schemas of `benchmark-model@7` (spec 0022, AC-12): what
 * `benchmark_snapshots.inputs`, `peers`, `loss` and `recommendation` hold, keyed by `model_version`
 * through `SNAPSHOT_SCHEMAS`. A row whose version has no schema — every `@1` to `@6` row, whose
 * schemas this spec deleted — is unreadable by design: the reader treats it as absent and the page
 * shows the `outdated` sentence (AC-18). Pure.
 */

/** The two rates a peer may publish and the model compares (AC-13). */
export const RATE_KEYS = ["ltifr", "trifr"] as const;
export type RateKey = (typeof RATE_KEYS)[number];

/**
 * One client KPI row the snapshot was computed from (AC-14): the value, the year it belongs to and
 * where it came from, so the page can say which figure and which year the loss rests on.
 */
export const inputKpiSchema = z.object({
  key: z.enum(KPI_KEYS),
  rowId: z.uuid(),
  value: z.number(),
  periodYear: z.number().int(),
  source: z.enum(["research", "client"]),
  confidence: z.number().min(0).max(1).nullable(),
  researchRunId: z.uuid().nullable(),
});
export type InputKpi = z.infer<typeof inputKpiSchema>;

/**
 * What the model was handed (AC-12): the company's exposure and identity at compute time, and the
 * client rows the loss used. `currency` is `companies.currency`, the one every amount in the
 * snapshot is denominated in.
 */
export const inputsSchema = z.object({
  fte: z.number().nullable(),
  section: z
    .string()
    .regex(/^[A-U]$/)
    .nullable(),
  industryCode: z.string().nullable(),
  country: z.string(),
  currency: z.string(),
  companyUpdatedAt: z.string(),
  kpis: z.array(inputKpiSchema),
});
export type SnapshotInputs = z.infer<typeof inputsSchema>;

/**
 * One kept peer of the research run, once (AC-13), with both rates it published side by side. A
 * rate the peer did not publish is null. `estimatedLoss` is that company's own yearly loss by the
 * same formula as the client's, from its published headcount and rates in the client's currency,
 * null when the peer published no headcount. It is a total, so it grows with the peer's size
 * (owner decision of 14 Sep 2026).
 */
export const peerRowSchema = z.object({
  peerName: z.string(),
  country: z.string(),
  headcount: z.number().int().positive().nullable(),
  periodYear: z.number().int(),
  ltifr: z.number().nullable(),
  trifr: z.number().nullable(),
  sourceUrl: z.string(),
  confidence: z.number().min(0).max(1),
  estimatedLoss: z.number().nullable(),
});
export type SnapshotPeerRow = z.infer<typeof peerRowSchema>;

/**
 * The client's standing on one rate among the peers that published it (AC-13). `rank` is one plus
 * the number of peers strictly better, so equal values share a rank, and is null when the client
 * has no value for that rate; `of` counts that rate's peers plus the client, who is one of the
 * compared set.
 */
export const rateStandingSchema = z.object({
  count: z.number().int().positive(),
  median: z.number(),
  best: z.number(),
  rank: z.number().int().min(1).nullable(),
  of: z.number().int().positive(),
  gapToMedian: z.number().nullable(),
});
export type RateStanding = z.infer<typeof rateStandingSchema>;

/**
 * The peers block (AC-13): one set of rows, sorted by LTIFR ascending with the peers lacking an
 * LTIFR last, plus the standing per rate at least one peer published. Null when the run kept no
 * peer at all; `thin` says the comparison rests on fewer than three.
 */
export const peersBlockSchema = z.object({
  rung: z.enum(PEER_RUNGS),
  thin: z.boolean(),
  rows: z.array(peerRowSchema),
  rates: z.partialRecord(z.enum(RATE_KEYS), rateStandingSchema),
});
export type SnapshotPeers = z.infer<typeof peersBlockSchema>;

/**
 * The estimated yearly loss (AC-14): the counts the client's own rates imply, the amount they cost,
 * and the same amount recomputed with the peer median and the best peer in place of the client's
 * rates. `trifrMissing` says the recordable term is zero because the client published no TRIFR
 * rather than because it has none. Null blocks mean no peers to compare against.
 */
export const lossBlockSchema = z.object({
  ltis: z.number(),
  recordables: z.number(),
  trifrMissing: z.boolean(),
  fatalities: z.number(),
  loss: z.number(),
  atMedian: z.number().nullable(),
  atBest: z.number().nullable(),
  savingAtMedian: z.number().nullable(),
  savingAtBest: z.number().nullable(),
});
export type SnapshotLoss = z.infer<typeof lossBlockSchema>;

/** The recommended package and why the standing chose it (AC-15). */
export const recommendationSchema = z.object({
  packageKey: z.enum(PACKAGE_KEYS),
  reason: z.enum([
    "fatality",
    "large_saving",
    "no_figures",
    "both_worse",
    "one_worse",
    "both_better",
  ]),
});
export type SnapshotRecommendation = z.infer<typeof recommendationSchema>;

/** The four blocks of a `benchmark-model@7` row (AC-12). */
export const snapshotBlocksV7Schema = z.object({
  inputs: inputsSchema,
  peers: peersBlockSchema.nullable(),
  loss: lossBlockSchema.nullable(),
  recommendation: recommendationSchema,
});
export type SnapshotBlocks = z.infer<typeof snapshotBlocksV7Schema>;

/** The scalar columns the task writes beside the blocks (AC-16). */
export type SnapshotScalars = {
  readonly kpisCompared: number;
  readonly confidence: number | null;
  readonly currency: string;
  readonly lossAmount: number | null;
  readonly savingAtMedian: number | null;
};

/** What `computeBenchmark` returns and the task stores. */
export type SnapshotBody = SnapshotBlocks & SnapshotScalars;

/**
 * The block schema per model version, under literal keys so a bump to `MODEL_VERSION` adds an entry
 * instead of renaming the only one. Spec 0022 (AC-12) deleted the `@1` to `@6` schemas with the
 * model they described, so a stored row of those versions is unreadable here on purpose: that is
 * what makes `benchmarkStateOf` answer `outdated` for it (AC-18).
 */
export const SNAPSHOT_SCHEMAS: Readonly<Record<string, z.ZodType<SnapshotBlocks>>> = {
  "benchmark-model@7": snapshotBlocksV7Schema,
};

/**
 * The four blocks as the row stores them. `benchmark_snapshots` gained no column for `loss` or
 * `recommendation` (AC-16 names only the three scalars), so `@7` writes them into the two jsonb
 * columns `@1` to `@6` left behind: the loss block into `cost`, which is the same figure under the
 * name the old model gave it, and the recommendation into `derived`. `results`, `gaps` and
 * `assumptions` stay null from `@7` on. The mapping lives here and in `benchmark-company`, nowhere
 * else, so a reader of either end sees it named.
 */
export type SnapshotRowLike = {
  readonly model_version: string;
  readonly inputs: unknown;
  readonly peers?: unknown;
  readonly cost?: unknown;
  readonly derived?: unknown;
};

/**
 * Parses a row's blocks with the schema its `model_version` names (AC-12). Returns the blocks, or
 * `{ error }` when the version is unknown or the row fails its schema. Pure.
 */
export function parseSnapshotBlocks(
  row: SnapshotRowLike,
):
  | { readonly blocks: SnapshotBlocks; readonly error: null }
  | { readonly blocks: null; readonly error: string } {
  const schema = SNAPSHOT_SCHEMAS[row.model_version];
  if (!schema) return { blocks: null, error: `unknown model version ${row.model_version}` };
  const parsed = schema.safeParse({
    inputs: row.inputs,
    peers: row.peers ?? null,
    loss: row.cost ?? null,
    recommendation: row.derived,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      blocks: null,
      error: `${issue?.path.map(String).join(".") ?? ""}: ${issue?.message ?? "invalid"}`,
    };
  }
  return { blocks: parsed.data, error: null };
}
