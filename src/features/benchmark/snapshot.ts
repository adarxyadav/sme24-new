import { z } from "zod";
import { KPI_KEYS } from "@/features/research/catalogue";
import { ASSUMPTION_KEYS, MODEL_VERSION, SIZE_BANDS } from "./catalogue";

/**
 * The snapshot block schemas (spec 0008, AC-4, AC-9): what `benchmark_snapshots.inputs`,
 * `results`, `gaps`, `cost` and `assumptions` hold, keyed by `model_version` through
 * `SNAPSHOT_SCHEMAS`. A row whose version has no schema, or that fails its schema, is treated
 * as absent by the reader. Pure.
 */

export const POSITIONS = ["top_quarter", "above_median", "below_median", "bottom_quarter"] as const;
export type Position = (typeof POSITIONS)[number];

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

/** The five jsonb blocks of a version 1 row. */
export const snapshotBlocksV1Schema = z.object({
  inputs: inputsSchema,
  results: z.array(resultSchema),
  gaps: z.array(gapSchema),
  cost: costSchema.nullable(),
  assumptions: z.array(assumptionUsedSchema),
});
export type SnapshotBlocks = z.infer<typeof snapshotBlocksV1Schema>;

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

/** The block schema per model version; a version missing here is unreadable by design. */
export const SNAPSHOT_SCHEMAS: Readonly<Record<string, z.ZodType<SnapshotBlocks>>> = {
  [MODEL_VERSION]: snapshotBlocksV1Schema,
};

export type SnapshotRowLike = {
  readonly model_version: string;
  readonly inputs: unknown;
  readonly results: unknown;
  readonly gaps: unknown;
  readonly cost: unknown;
  readonly assumptions: unknown;
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
