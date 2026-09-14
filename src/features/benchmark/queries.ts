import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { BENCHMARK_WAIT_MS, type BenchmarkState, MODEL_VERSION } from "./catalogue";
import { parseSnapshotBlocks, type SnapshotBlocks } from "./snapshot";

type Client = SupabaseClient<Database>;

export type SnapshotRow = Tables<"benchmark_snapshots">;

/**
 * The newest snapshot with its blocks parsed by the schema its version names (spec 0008, AC-9).
 * `modelVersion` is the raw stored version and `blocks` is null when this code cannot read it
 * (spec 0022, AC-18): every `@1` to `@6` row, whose schemas went with the model they described.
 * The CHF scalars are kept because ops still read them off stored rows; a `@7` row leaves them null
 * and carries `currency`, `lossAmount` and `savingAtMedian` instead.
 */
export type ParsedSnapshot = {
  readonly id: string;
  readonly createdAt: string;
  readonly triggerKind: SnapshotRow["trigger_kind"];
  readonly modelVersion: string;
  readonly kpisCompared: number;
  readonly confidence: number | null;
  readonly currency: string | null;
  readonly lossAmount: number | null;
  readonly savingAtMedian: number | null;
  readonly costChf: number | null;
  readonly savingMedianChf: number | null;
  readonly savingTopChf: number | null;
  readonly blocks: SnapshotBlocks | null;
};

/**
 * A row to a parsed snapshot. A row whose version or blocks this code cannot read still comes back,
 * with `blocks` null and the reason beside it (spec 0022, AC-18): the page needs the version to say
 * the figures are from an older model, and rendering nothing from the row is the point. Pure.
 */
export function parseSnapshotRow(row: SnapshotRow): {
  readonly snapshot: ParsedSnapshot;
  readonly error: string | null;
} {
  const parsed = parseSnapshotBlocks(row);
  const number = (value: number | string | null) => (value === null ? null : Number(value));
  return {
    snapshot: {
      id: row.id,
      createdAt: row.created_at,
      triggerKind: row.trigger_kind,
      modelVersion: row.model_version,
      kpisCompared: row.kpis_compared,
      confidence: number(row.confidence),
      currency: row.currency,
      lossAmount: number(row.loss_amount),
      savingAtMedian: number(row.saving_at_median),
      costChf: number(row.cost_chf),
      savingMedianChf: number(row.saving_median_chf),
      savingTopChf: number(row.saving_top_chf),
      blocks: parsed.blocks,
    },
    error: parsed.error,
  };
}

/**
 * The company's newest snapshot by `created_at`, parsed by its version (AC-9). A row of a version
 * this code no longer reads comes back with null blocks, which `benchmarkStateOf` turns into
 * `outdated` (spec 0022, AC-18); a `@7` row that fails its own schema is reported to Sentry, since
 * that is a bug rather than an old row. Throws on a database error. Server component.
 */
export async function loadLatestSnapshot(
  supabase: Client,
  companyId: string,
): Promise<ParsedSnapshot | null> {
  const { data, error } = await supabase
    .from("benchmark_snapshots")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!data) return null;
  const parsed = parseSnapshotRow(data);
  if (parsed.error === null) return parsed.snapshot;
  log.warn("benchmark snapshot unreadable, shown as outdated", {
    snapshotId: data.id,
    companyId,
    modelVersion: data.model_version,
    reason: parsed.error,
  });
  // An old version is expected after a model change and is not worth an issue; a current row that
  // fails its own schema is a real defect.
  if (data.model_version === MODEL_VERSION) {
    Sentry.captureMessage("benchmark snapshot unreadable", {
      level: "warning",
      tags: { source: "benchmark-queries" },
      extra: {
        snapshotId: data.id,
        companyId,
        modelVersion: data.model_version,
        reason: parsed.error,
      },
    });
  }
  return parsed.snapshot;
}

export type BenchmarkStateInput = {
  readonly snapshot: ParsedSnapshot | null;
  readonly latestRun: { readonly status: string; readonly finished_at: string | null } | null;
  readonly companyUpdatedAt: string;
  /** The newest client KPI write (spec 0010, AC-13), `null` when the client entered nothing. */
  readonly clientKpiUpdatedAt: string | null;
  readonly now: Date;
};

/**
 * The dashboard state (AC-9, spec 0022 AC-18): a snapshot this code cannot read is `outdated`, a
 * snapshot with nothing compared is `noData`, any other snapshot is `ready`; with no snapshot, a run
 * that succeeded, a company edit or a client KPI save (spec 0010, AC-13) younger than the wait
 * window is `calculating`, anything older is `unavailable`. Pure.
 */
export function benchmarkStateOf({
  snapshot,
  latestRun,
  companyUpdatedAt,
  clientKpiUpdatedAt,
  now,
}: BenchmarkStateInput): BenchmarkState {
  if (snapshot) {
    if (snapshot.blocks === null || snapshot.modelVersion !== MODEL_VERSION) return "outdated";
    return snapshot.blocks.loss === null && snapshot.blocks.peers === null ? "noData" : "ready";
  }
  const moments = [
    latestRun?.status === "succeeded" ? latestRun.finished_at : null,
    companyUpdatedAt,
    clientKpiUpdatedAt,
  ].flatMap((value) => {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? [time] : [];
  });
  const latest = Math.max(...moments, Number.NEGATIVE_INFINITY);
  return now.getTime() - latest < BENCHMARK_WAIT_MS ? "calculating" : "unavailable";
}
