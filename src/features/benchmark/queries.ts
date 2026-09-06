import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/logger";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { BENCHMARK_WAIT_MS, type BenchmarkState } from "./catalogue";
import { parseSnapshotBlocks, type SnapshotBlocks } from "./snapshot";

type Client = SupabaseClient<Database>;

export type SnapshotRow = Tables<"benchmark_snapshots">;

/** The newest snapshot with its blocks parsed by the schema its version names (spec 0008, AC-9). */
export type ParsedSnapshot = {
  readonly id: string;
  readonly createdAt: string;
  readonly triggerKind: SnapshotRow["trigger_kind"];
  readonly modelVersion: string;
  readonly kpisCompared: number;
  readonly peerProvisional: boolean;
  readonly confidence: number | null;
  readonly costChf: number | null;
  readonly costLowChf: number | null;
  readonly costHighChf: number | null;
  readonly savingMedianChf: number | null;
  readonly savingTopChf: number | null;
  readonly blocks: SnapshotBlocks;
};

/** A row to a parsed snapshot, or `null` (with the reason) when its version or blocks are unreadable. Pure. */
export function parseSnapshotRow(
  row: SnapshotRow,
):
  | { readonly snapshot: ParsedSnapshot; readonly error: null }
  | { readonly snapshot: null; readonly error: string } {
  const parsed = parseSnapshotBlocks(row);
  if (parsed.blocks === null) return { snapshot: null, error: parsed.error };
  const number = (value: number | string | null) => (value === null ? null : Number(value));
  return {
    snapshot: {
      id: row.id,
      createdAt: row.created_at,
      triggerKind: row.trigger_kind,
      modelVersion: row.model_version,
      kpisCompared: row.kpis_compared,
      peerProvisional: row.peer_provisional,
      confidence: number(row.confidence),
      costChf: number(row.cost_chf),
      costLowChf: number(row.cost_low_chf),
      costHighChf: number(row.cost_high_chf),
      savingMedianChf: number(row.saving_median_chf),
      savingTopChf: number(row.saving_top_chf),
      blocks: parsed.blocks,
    },
    error: null,
  };
}

/**
 * The company's newest snapshot by `created_at`, parsed by its version (AC-9). A row with an
 * unknown version or broken blocks is treated as absent and reported to Sentry. Throws on a
 * database error. Server component.
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
  if (parsed.snapshot) return parsed.snapshot;
  log.warn("benchmark snapshot unreadable, treated as absent", {
    snapshotId: data.id,
    companyId,
    modelVersion: data.model_version,
    reason: parsed.error,
  });
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
  return null;
}

export type AssumptionRow = Tables<"benchmark_assumptions">;

/** The assumption rows, whose labels and notes the disclosure shows by key (AC-10). Throws on a database error. Server component. */
export async function loadAssumptionRows(supabase: Client): Promise<readonly AssumptionRow[]> {
  const { data, error } = await supabase.from("benchmark_assumptions").select("*");
  if (error) throw queryError(error);
  return data;
}

export type BenchmarkStateInput = {
  readonly snapshot: ParsedSnapshot | null;
  readonly latestRun: { readonly status: string; readonly finished_at: string | null } | null;
  readonly companyUpdatedAt: string;
  readonly now: Date;
};

/**
 * The dashboard state (AC-9): a snapshot with nothing compared is `noData`, any other snapshot is
 * `ready`; with no snapshot, a run that succeeded or a company edit younger than the wait window
 * is `calculating`, anything older is `unavailable`. Pure.
 */
export function benchmarkStateOf({
  snapshot,
  latestRun,
  companyUpdatedAt,
  now,
}: BenchmarkStateInput): BenchmarkState {
  if (snapshot) return snapshot.kpisCompared === 0 ? "noData" : "ready";
  const moments = [
    latestRun?.status === "succeeded" ? latestRun.finished_at : null,
    companyUpdatedAt,
  ].flatMap((value) => {
    const time = value ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? [time] : [];
  });
  const latest = Math.max(...moments, Number.NEGATIVE_INFINITY);
  return now.getTime() - latest < BENCHMARK_WAIT_MS ? "calculating" : "unavailable";
}
