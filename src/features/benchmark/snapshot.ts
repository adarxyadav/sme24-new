import { z } from "zod";
import { KPI_KEYS } from "@/features/research/catalogue";
import { ASSUMPTION_KEYS, SIZE_BANDS } from "./catalogue";

/**
 * The snapshot block schemas (spec 0008, AC-4, AC-9): what `benchmark_snapshots.inputs`,
 * `results`, `gaps`, `cost` and `assumptions` hold, keyed by `model_version` through
 * `SNAPSHOT_SCHEMAS`. A row whose version has no schema, or that fails its schema, is treated
 * as absent by the reader. Pure.
 */

/**
 * The position bands. The four quartile values describe a real distribution; the two average
 * values (spec 0016, AC-5) describe a peer row that holds one number repeated as all three
 * quartiles, where a quartile word would claim a spread nobody measured.
 */
export const POSITIONS = [
  "top_quarter",
  "above_median",
  "below_median",
  "bottom_quarter",
  "above_average",
  "below_average",
] as const;
export type Position = (typeof POSITIONS)[number];

/**
 * What a peer row actually holds (spec 0016, AC-4): a `point` row is one figure repeated as all
 * three quartiles, a `distribution` row carries real spread. Derived from the values, never a
 * stored column and never hand typed.
 */
export const PEER_SHAPES = ["point", "distribution"] as const;
export type PeerShape = (typeof PEER_SHAPES)[number];

/** A peer row's shape from its quartiles: all three equal is a point row (spec 0016, AC-4). Pure. */
export function peerShapeOf(quartiles: {
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
}): PeerShape {
  return quartiles.p25 === quartiles.median && quartiles.median === quartiles.p75
    ? "point"
    : "distribution";
}

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

export const inputsSchema = z.object({
  fte: z.number().nullable(),
  section: z
    .string()
    .regex(/^[A-U]$/)
    .nullable(),
  sizeBand: z.enum(SIZE_BANDS),
  industryCode: z.string().nullable(),
  companyUpdatedAt: z.string(),
  kpis: z.array(inputKpiSchema),
});
export type SnapshotInputs = z.infer<typeof inputsSchema>;

export const peerSchema = z.object({
  rowId: z.uuid(),
  rung: z.number().int().min(1).max(4),
  industrySection: z.string(),
  sizeBand: z.enum(SIZE_BANDS),
  periodYear: z.number().int(),
  yearMatch: z.enum(["same", "nearest"]),
  p25: z.number(),
  median: z.number(),
  p75: z.number(),
  sampleSize: z.number().int().nullable(),
  provisional: z.boolean(),
});
export type SnapshotPeer = z.infer<typeof peerSchema>;

/**
 * The version 3 peer block (spec 0016): the shape the row actually holds, plus the source's own
 * classification and the sentence saying what the quartiles describe, so the client sees the
 * caveat instead of it dying in the database the way `source_note` does.
 */
export const peerV3Schema = peerSchema.extend({
  shape: z.enum(PEER_SHAPES),
  sourceKey: z.string().nullable(),
  basis: z.object({ de: z.string(), en: z.string() }).nullable(),
});
export type SnapshotPeerV3 = z.infer<typeof peerV3Schema>;

export const resultSchema = z.object({
  key: z.enum(KPI_KEYS),
  peer: peerSchema.nullable(),
  position: z.enum(POSITIONS).nullable(),
  gapToMedian: z.number().nullable(),
  gapRelative: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});
export type SnapshotResult = z.infer<typeof resultSchema>;

export const gapSchema = z.object({
  rank: z.number().int().min(1),
  key: z.enum(KPI_KEYS),
  reason: z.enum(["cost", "distance", "fatality"]),
  savingMedianChf: z.number().nullable(),
  gapRelative: z.number().nullable(),
});
export type SnapshotGap = z.infer<typeof gapSchema>;

export const costSchema = z.object({
  incidentKpi: z.enum(["accident_rate_per_1000_fte", "ltifr"]),
  incidents: z.number(),
  lostDays: z.number(),
  lostDaysSource: z.enum(["kpi", "default"]),
  costPerCase: z.number(),
  annual: z.number(),
  low: z.number(),
  high: z.number(),
  atMedian: z.number().nullable(),
  atTop: z.number().nullable(),
  savingMedian: z.number().nullable(),
  savingTop: z.number().nullable(),
});
export type SnapshotCost = z.infer<typeof costSchema>;

export const assumptionUsedSchema = z.object({
  key: z.enum(ASSUMPTION_KEYS),
  value: z.number(),
  unit: z.string(),
  sourceName: z.string(),
  sourceUrl: z.string().nullable(),
  provisional: z.boolean(),
  effectiveFrom: z.string(),
});
export type AssumptionUsed = z.infer<typeof assumptionUsedSchema>;

/**
 * The version 3 assumption block (spec 0016, AC-10): whether the value is a declared assumption
 * with no published source, and the note that says so, so the disclosure can name each multiplier
 * boundary and its source rather than presenting all seven constants alike.
 */
export const assumptionUsedV3Schema = assumptionUsedSchema.extend({
  isAssumption: z.boolean(),
  note: z.object({ de: z.string(), en: z.string() }).nullable(),
});
export type AssumptionUsedV3 = z.infer<typeof assumptionUsedV3Schema>;

/**
 * One derived injury count (spec 0012): the count itself plus the rate row it came from, so the
 * card can name the figure and its year. Deliberately carries no confidence: a derived value
 * inherits its input's reliability and must not look independently assessed (AC-5).
 */
export const derivedCountSchema = z.object({
  count: z.number(),
  fromKey: z.enum(["ltifr", "trifr", "accident_rate_per_1000_fte"]),
  fromValue: z.number(),
  fromSource: z.enum(["research", "client"]),
  fromYear: z.number().int(),
});
export type DerivedCount = z.infer<typeof derivedCountSchema>;
export type DerivedFromKey = DerivedCount["fromKey"];

/**
 * The display only derived block (spec 0012): the exposure the counts were worked out from, and
 * each count independently nullable. The whole block is null without a positive FTE or without
 * the `hours_per_fte` assumption (AC-7, AC-16).
 */
export const derivedSchema = z.object({
  fte: z.number(),
  hoursPerFte: z.number(),
  lostTime: derivedCountSchema.nullable(),
  recordable: derivedCountSchema.nullable(),
});
export type SnapshotDerived = z.infer<typeof derivedSchema>;

/** The five jsonb blocks of a version 1 row. */
export const snapshotBlocksV1Schema = z.object({
  inputs: inputsSchema,
  results: z.array(resultSchema),
  gaps: z.array(gapSchema),
  cost: costSchema.nullable(),
  assumptions: z.array(assumptionUsedSchema),
});
/** The version 1 blocks plus the derived block (spec 0012). */
export const snapshotBlocksV2Schema = snapshotBlocksV1Schema.extend({
  derived: derivedSchema.nullable(),
});

/** A version 3 result: the peer block carries the shape and the two source columns (spec 0016). */
export const resultV3Schema = resultSchema.extend({
  peer: peerV3Schema.nullable(),
});
export type SnapshotResultV3 = z.infer<typeof resultV3Schema>;

/**
 * The version 3 blocks (spec 0016): version 2 plus the peer shape and its source columns, and the
 * assumption note and its flag. The arithmetic is unchanged; only what the snapshot records about
 * its own values grows.
 */
export const snapshotBlocksV3Schema = snapshotBlocksV2Schema.extend({
  results: z.array(resultV3Schema),
  assumptions: z.array(assumptionUsedV3Schema),
});

/**
 * What a reader gets from any version. `derived` is optional because a stored version 1 row has
 * no such key and is never widened to carry one (AC-12); a version 2 row always sets it. The
 * version 3 additions are optional per field for the same reason (spec 0016, AC-12): a stored
 * `@1` or `@2` row keeps parsing and rendering under its own schema, so every reader of a shape,
 * a basis or a note must handle its absence rather than assume the newest version.
 */
export type SnapshotBlocks = Omit<z.infer<typeof snapshotBlocksV1Schema>, "results"> & {
  readonly results: readonly (SnapshotResult & {
    readonly peer: (SnapshotPeer & Partial<Omit<SnapshotPeerV3, keyof SnapshotPeer>>) | null;
  })[];
  readonly assumptions: readonly (AssumptionUsed &
    Partial<Omit<AssumptionUsedV3, keyof AssumptionUsed>>)[];
  readonly derived?: SnapshotDerived | null;
};

/** The scalar columns the task writes beside the blocks. */
export type SnapshotScalars = {
  readonly kpisCompared: number;
  readonly peerProvisional: boolean;
  readonly confidence: number | null;
  readonly costChf: number | null;
  readonly costLowChf: number | null;
  readonly costHighChf: number | null;
  readonly savingMedianChf: number | null;
  readonly savingTopChf: number | null;
};

/** What `computeBenchmark` returns and the task stores. */
export type SnapshotBody = SnapshotBlocks & SnapshotScalars;

/**
 * The block schema per model version, under literal keys so a bump to `MODEL_VERSION` adds an
 * entry instead of renaming the only one. A version missing here is unreadable by design.
 */
export const SNAPSHOT_SCHEMAS: Readonly<Record<string, z.ZodType<SnapshotBlocks>>> = {
  "benchmark-model@1": snapshotBlocksV1Schema,
  "benchmark-model@2": snapshotBlocksV2Schema,
  "benchmark-model@3": snapshotBlocksV3Schema,
};

export type SnapshotRowLike = {
  readonly model_version: string;
  readonly inputs: unknown;
  readonly results: unknown;
  readonly gaps: unknown;
  readonly cost: unknown;
  readonly assumptions: unknown;
  readonly derived?: unknown;
};

/**
 * Parses a row's blocks with the schema its `model_version` names (AC-9). Returns the blocks, or
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
    results: row.results,
    gaps: row.gaps,
    cost: row.cost,
    assumptions: row.assumptions,
    derived: row.derived ?? null,
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
