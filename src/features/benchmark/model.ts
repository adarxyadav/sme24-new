import { KPI_CATALOGUE, type KpiKey } from "@/features/research/catalogue";
import {
  type AssumptionKey,
  COST_LINKED_KPIS,
  type SizeBand,
  sectionOfDivision,
  sizeBandOf,
} from "./catalogue";
import type {
  AssumptionUsed,
  InputKpi,
  Position,
  SnapshotBody,
  SnapshotCost,
  SnapshotGap,
  SnapshotPeer,
  SnapshotResult,
} from "./snapshot";

/**
 * The benchmark model (spec 0008, AC-4 and AC-18): pure arithmetic over stored rows. The task
 * feeds it the company, the active catalogue, the current KPI rows, the candidate peer rows and
 * the assumptions; it returns the snapshot body (blocks and scalars). Runs anywhere, no I/O.
 */

export type ModelCompany = {
  readonly id: string;
  readonly employeesCount: number | null;
  readonly industryCode: string | null;
  /** `companies.updated_at` from the re read right before computing (AC-5). */
  readonly updatedAt: string;
};

export type ModelCatalogueEntry = {
  readonly key: KpiKey;
  readonly direction: "lower_is_better" | "higher_is_better" | "neutral";
  readonly sortOrder: number;
};

export type ModelKpiRow = {
  readonly id: string;
  readonly kpiKey: KpiKey;
  readonly value: number;
  readonly periodYear: number;
  readonly source: "research" | "client";
  readonly confidence: number | null;
  readonly researchRunId: string | null;
};

export type ModelPeerRow = {
  readonly id: string;
  readonly kpiKey: KpiKey;
  readonly industrySection: string;
  readonly sizeBand: SizeBand;
  readonly periodYear: number;
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly sampleSize: number | null;
  readonly provisional: boolean;
};

export type ModelAssumption = AssumptionUsed;

export type ModelInput = {
  readonly company: ModelCompany;
  readonly catalogue: readonly ModelCatalogueEntry[];
  readonly kpis: readonly ModelKpiRow[];
  readonly peers: readonly ModelPeerRow[];
  readonly assumptions: readonly ModelAssumption[];
  readonly now?: Date;
};

/** Rounds a CHF amount for display and the email (AC-18 rule 8): nearest 100 below 10 000, else nearest 1 000. Pure. */
export function roundChf(value: number): number {
  const step = Math.abs(value) < 10_000 ? 100 : 1_000;
  return Math.round(value / step) * step;
}

/** The KPI's newest row: the highest `period_year` wins (AC-4 rule 1). Pure. */
function newestRow(rows: readonly ModelKpiRow[], key: KpiKey): ModelKpiRow | null {
  return rows
    .filter((row) => row.kpiKey === key)
    .reduce<ModelKpiRow | null>(
      (best, row) => (best === null || row.periodYear > best.periodYear ? row : best),
      null,
    );
}

/** The peer row for a KPI: the first rung with any row, then the year rule (AC-4 rule 2). Pure. */
export function selectPeer(
  peers: readonly ModelPeerRow[],
  key: KpiKey,
  section: string | null,
  band: SizeBand,
  year: number,
): SnapshotPeer | null {
  const ladder: ReadonlyArray<readonly [section: string | null, band: SizeBand]> = [
    [section, band],
    [section, "all"],
    ["ALL", band],
    ["ALL", "all"],
  ];
  for (const [rungIndex, [rungSection, rungBand]] of ladder.entries()) {
    if (rungSection === null) continue;
    const candidates = peers.filter(
      (row) =>
        row.kpiKey === key && row.industrySection === rungSection && row.sizeBand === rungBand,
    );
    if (candidates.length === 0) continue;
    const chosen = candidates.reduce((best, row) => {
      const distance = Math.abs(row.periodYear - year);
      const bestDistance = Math.abs(best.periodYear - year);
      if (distance < bestDistance) return row;
      if (distance === bestDistance && row.periodYear > best.periodYear) return row;
      return best;
    });
    return {
      rowId: chosen.id,
      rung: rungIndex + 1,
      industrySection: chosen.industrySection,
      sizeBand: chosen.sizeBand,
      periodYear: chosen.periodYear,
      yearMatch: chosen.periodYear === year ? "same" : "nearest",
      p25: chosen.p25,
      median: chosen.median,
      p75: chosen.p75,
      sampleSize: chosen.sampleSize,
      provisional: chosen.provisional,
    };
  }
  return null;
}

/** The position band of a value against the peer quartiles (AC-4 rule 3). Pure. */
export function positionOf(
  key: KpiKey,
  direction: ModelCatalogueEntry["direction"],
  value: number,
  peer: Pick<SnapshotPeer, "p25" | "median" | "p75">,
): Position {
  if (key === "iso_45001_certified") return value >= 1 ? "above_median" : "below_median";
  if (direction === "higher_is_better") {
    if (value >= peer.p75) return "top_quarter";
    if (value >= peer.median) return "above_median";
    if (value >= peer.p25) return "below_median";
    return "bottom_quarter";
  }
  if (value <= peer.p25) return "top_quarter";
  if (value <= peer.median) return "above_median";
  if (value <= peer.p75) return "below_median";
  return "bottom_quarter";
}

/** The signed gap in the KPI's unit, positive meaning worse than the median, and its relative size (AC-4 rule 4). Pure. */
export function gapOf(
  key: KpiKey,
  direction: ModelCatalogueEntry["direction"],
  value: number,
  median: number,
): { readonly gapToMedian: number; readonly gapRelative: number | null } {
  if (key === "iso_45001_certified") {
    const gapToMedian = value >= 1 ? 0 : median;
    return { gapToMedian, gapRelative: value >= 1 ? 0 : 1 };
  }
  const gapToMedian = direction === "higher_is_better" ? median - value : value - median;
  return { gapToMedian, gapRelative: median === 0 ? null : gapToMedian / median };
}

type CostParts = {
  readonly incidents: number;
  readonly lostDays: number;
  readonly costPerCase: number;
  readonly annual: number;
};

/** One evaluation of the cost formula (AC-18 rule 5). Pure. */
function costAt(
  incidentKpi: "accident_rate_per_1000_fte" | "ltifr",
  rate: number,
  fte: number,
  lostDays: number,
  values: Record<AssumptionKey, number>,
  multiplier: number,
): CostParts {
  const incidents =
    incidentKpi === "accident_rate_per_1000_fte"
      ? (rate * fte) / 1000
      : (rate * fte * values.hours_per_fte) / 1_000_000;
  const costPerCase = values.direct_cost_per_case_chf + lostDays * values.cost_per_absence_day_chf;
  return { incidents, lostDays, costPerCase, annual: incidents * costPerCase * multiplier };
}

/** Sorts by a numeric key descending with `null` last, ties and nulls by catalogue sort order. Pure. */
function rankBy<T extends { readonly key: KpiKey }>(
  items: readonly T[],
  sortKey: (item: T) => number | null,
  sortOrder: (key: KpiKey) => number,
): readonly T[] {
  return [...items].sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    if (ka !== null && kb !== null && ka !== kb) return kb - ka;
    if (ka === null && kb !== null) return 1;
    if (ka !== null && kb === null) return -1;
    return sortOrder(a.key) - sortOrder(b.key);
  });
}

/**
 * Computes the snapshot body for one company (spec 0008, AC-4 and AC-18): inputs, peer
 * selection, positions and gaps, the incident cost with its range and savings, the ranked gaps,
 * the confidence and the scalar columns. Pure; the task validates and stores the result.
 */
export function computeBenchmark({
  company,
  catalogue,
  kpis,
  peers,
  assumptions,
}: ModelInput): SnapshotBody {
  const active = catalogue.filter((entry) => entry.key in KPI_CATALOGUE);
  const sortOrder = (key: KpiKey) => active.find((entry) => entry.key === key)?.sortOrder ?? 0;
  const direction = (key: KpiKey) =>
    active.find((entry) => entry.key === key)?.direction ?? KPI_CATALOGUE[key].direction;

  // (1) Inputs.
  const fte = company.employeesCount;
  const section = sectionOfDivision(company.industryCode);
  const sizeBand = sizeBandOf(company.employeesCount);
  const rows = active.flatMap((entry) => {
    const row = newestRow(kpis, entry.key);
    return row ? [row] : [];
  });
  const inputKpis: InputKpi[] = rows.map((row) => ({
    key: row.kpiKey,
    rowId: row.id,
    value: row.value,
    periodYear: row.periodYear,
    source: row.source,
    confidence: row.source === "client" ? 1 : row.confidence,
    researchRunId: row.researchRunId,
  }));

  // (2) to (4) and (7) per KPI: peer, position, gap, confidence.
  const results: SnapshotResult[] = inputKpis.map((input) => {
    const peer = selectPeer(peers, input.key, section, sizeBand, input.periodYear);
    if (!peer) {
      return {
        key: input.key,
        peer: null,
        position: null,
        gapToMedian: null,
        gapRelative: null,
        confidence: input.confidence,
      };
    }
    const gap = gapOf(input.key, direction(input.key), input.value, peer.median);
    return {
      key: input.key,
      peer,
      position: positionOf(input.key, direction(input.key), input.value, peer),
      gapToMedian: gap.gapToMedian,
      gapRelative: gap.gapRelative,
      confidence: input.confidence,
    };
  });
  const resultOf = (key: KpiKey) => results.find((result) => result.key === key);
  const inputOf = (key: KpiKey) => inputKpis.find((input) => input.key === key);

  // (5) Cost.
  const values = Object.fromEntries(
    assumptions.map((assumption) => [assumption.key, assumption.value]),
  ) as Record<AssumptionKey, number>;
  const accidentRate = inputOf("accident_rate_per_1000_fte");
  const ltifr = inputOf("ltifr");
  const incidentInput = accidentRate ?? ltifr ?? null;
  const incidentKpi: SnapshotCost["incidentKpi"] | null = accidentRate
    ? "accident_rate_per_1000_fte"
    : ltifr
      ? "ltifr"
      : null;
  const lostDaysInput = inputOf("lost_days_per_incident");
  const usedAssumptionKeys = new Set<AssumptionKey>();
  let cost: SnapshotCost | null = null;
  if (fte && fte > 0 && incidentInput && incidentKpi) {
    const lostDays = lostDaysInput ? lostDaysInput.value : values.lost_days_per_incident_default;
    const lostDaysSource: SnapshotCost["lostDaysSource"] = lostDaysInput ? "kpi" : "default";
    const at = (rate: number, days: number, multiplier: number) =>
      costAt(incidentKpi, rate, fte, days, values, multiplier);
    const main = at(incidentInput.value, lostDays, values.indirect_multiplier);
    const low = at(incidentInput.value, lostDays, values.indirect_multiplier_low).annual;
    const high = at(incidentInput.value, lostDays, values.indirect_multiplier_high).annual;
    const incidentPeer = resultOf(incidentKpi)?.peer ?? null;
    const lostDaysPeer = resultOf("lost_days_per_incident")?.peer ?? null;
    const reference = (quartile: "median" | "p25"): number | null => {
      if (!incidentPeer || incidentPeer[quartile] === 0) return null;
      const days = lostDaysPeer ? lostDaysPeer[quartile] : lostDays;
      return at(incidentPeer[quartile], days, values.indirect_multiplier).annual;
    };
    const atMedian = reference("median");
    const atTop = reference("p25");
    cost = {
      incidentKpi,
      incidents: main.incidents,
      lostDays,
      lostDaysSource,
      costPerCase: main.costPerCase,
      annual: main.annual,
      low,
      high,
      atMedian,
      atTop,
      savingMedian: atMedian === null ? null : Math.max(0, main.annual - atMedian),
      savingTop: atTop === null ? null : Math.max(0, main.annual - atTop),
    };
    for (const key of [
      "direct_cost_per_case_chf",
      "cost_per_absence_day_chf",
      "indirect_multiplier_low",
      "indirect_multiplier",
      "indirect_multiplier_high",
    ] as const) {
      usedAssumptionKeys.add(key);
    }
    if (incidentKpi === "ltifr") usedAssumptionKeys.add("hours_per_fte");
    if (lostDaysSource === "default") usedAssumptionKeys.add("lost_days_per_incident_default");
  }

  // (6) Ranking.
  const gapResults = results.filter(
    (result) => result.gapToMedian !== null && result.gapToMedian > 0,
  );
  const fatalityInput = inputOf("fatalities");
  const fatality: SnapshotGap[] =
    fatalityInput && fatalityInput.value > 0
      ? [
          {
            rank: 0,
            key: "fatalities",
            reason: "fatality",
            savingMedianChf: null,
            gapRelative: resultOf("fatalities")?.gapRelative ?? null,
          },
        ]
      : [];
  const soloSaving = (key: KpiKey): number | null => {
    if (!cost || !incidentKpi || !incidentInput || !fte) return null;
    const peer = resultOf(key)?.peer;
    if (!peer) return null;
    const at = (rate: number, days: number) =>
      costAt(incidentKpi, rate, fte, days, values, values.indirect_multiplier).annual;
    if (key === incidentKpi) {
      return Math.max(0, cost.annual - at(peer.median, cost.lostDays));
    }
    if (key === "lost_days_per_incident") {
      return Math.max(0, cost.annual - at(incidentInput.value, peer.median));
    }
    return null;
  };
  const costLinked = rankBy(
    gapResults
      .filter((result) => COST_LINKED_KPIS.includes(result.key) && result.key !== "fatalities")
      .map((result) => ({
        key: result.key,
        reason: "cost" as const,
        savingMedianChf: soloSaving(result.key),
        gapRelative: result.gapRelative,
      })),
    (gap) => gap.savingMedianChf,
    sortOrder,
  );
  const others = rankBy(
    gapResults
      .filter((result) => !COST_LINKED_KPIS.includes(result.key) && result.key !== "fatalities")
      .map((result) => ({
        key: result.key,
        reason: "distance" as const,
        savingMedianChf: null,
        gapRelative: result.gapRelative,
      })),
    (gap) => gap.gapRelative,
    sortOrder,
  );
  const gaps: SnapshotGap[] = [...fatality, ...costLinked, ...others].map((gap, index) => ({
    ...gap,
    rank: index + 1,
  }));

  // (7) Confidence over the rows the cost used.
  const costRows = cost
    ? [incidentInput, cost.lostDaysSource === "kpi" ? lostDaysInput : undefined].filter(
        (input): input is InputKpi => input !== undefined && input !== null,
      )
    : [];
  const costConfidences = costRows.flatMap((input) =>
    input.confidence === null ? [] : [input.confidence],
  );
  const confidence = cost && costConfidences.length > 0 ? Math.min(...costConfidences) : null;

  // (8) Scalars and the assumptions block.
  const usedAssumptions = assumptions.filter((assumption) =>
    usedAssumptionKeys.has(assumption.key),
  );
  const peerProvisional =
    results.some((result) => result.peer?.provisional === true) ||
    usedAssumptions.some((assumption) => assumption.provisional);

  return {
    inputs: {
      fte,
      section,
      sizeBand,
      industryCode: company.industryCode,
      companyUpdatedAt: company.updatedAt,
      kpis: inputKpis,
    },
    results,
    gaps,
    cost,
    assumptions: usedAssumptions,
    kpisCompared: results.filter((result) => result.peer !== null).length,
    peerProvisional,
    confidence,
    costChf: cost?.annual ?? null,
    costLowChf: cost?.low ?? null,
    costHighChf: cost?.high ?? null,
    savingMedianChf: cost?.savingMedian ?? null,
    savingTopChf: cost?.savingTop ?? null,
  };
}
