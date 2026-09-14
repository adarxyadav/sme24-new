import type { KpiKey } from "@/features/research/catalogue";
import type { PeerRung } from "@/features/research/summary";
import { sectionOfDivision } from "./catalogue";
import {
  FATALITY_COST,
  HOURLY_COST,
  HOURS_PER_FTE,
  HOURS_PER_LTI,
  HOURS_PER_RECORDABLE,
  LARGE_SAVING,
} from "./loss";
import type {
  InputKpi,
  RateKey,
  RateStanding,
  SnapshotBody,
  SnapshotLoss,
  SnapshotPeerRow,
  SnapshotPeers,
  SnapshotRecommendation,
} from "./snapshot";

/**
 * The benchmark model (spec 0022, AC-12 to AC-15): pure arithmetic over the company, its own KPI
 * rows and the peers one research run found. No sector table, no curated library and no stored
 * assumption reaches it any more; the five constants of `loss.ts` are the only numbers it does not
 * receive. Returns the `benchmark-model@7` body. Runs anywhere, no I/O.
 */

export type ModelCompany = {
  readonly id: string;
  readonly employeesCount: number | null;
  readonly industryCode: string | null;
  /** `companies.country` (AC-1), copied into the inputs so the page can name the rung's geography. */
  readonly country: string;
  /** `companies.currency` (AC-2): every amount in the snapshot is denominated in it. */
  readonly currency: string;
  /** `companies.updated_at` from the re read right before computing. */
  readonly updatedAt: string;
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

/** One `research_peers` row as the task loads it (AC-17): one peer, one rate, per million hours. */
export type ModelPeerRow = {
  readonly peerName: string;
  readonly country: string;
  readonly headcount: number | null;
  readonly kpiKey: RateKey;
  readonly periodYear: number;
  readonly value: number;
  readonly sourceUrl: string;
  readonly confidence: number;
  readonly rung: PeerRung;
};

export type ModelInput = {
  readonly company: ModelCompany;
  readonly kpis: readonly ModelKpiRow[];
  /** The peers of the one run AC-17 names; empty means the peers block is null. */
  readonly peers: readonly ModelPeerRow[];
  /** True when the run's peer search rested on fewer than three peers (`summary.peers.thin`). */
  readonly thin?: boolean;
};

/** The three client KPIs the loss formula reads; nothing else is compared from `@7` on. */
const LOSS_KPIS = ["ltifr", "trifr", "fatalities"] as const;

/** The KPI's newest row: the highest `period_year` wins, chosen per key independently (AC-14). Pure. */
function newestRow(rows: readonly ModelKpiRow[], key: KpiKey): ModelKpiRow | null {
  return rows
    .filter((row) => row.kpiKey === key)
    .reduce<ModelKpiRow | null>(
      (best, row) => (best === null || row.periodYear > best.periodYear ? row : best),
      null,
    );
}

/**
 * The yearly loss of one company from its own exposure and rates (AC-14): the owner's table, the
 * one formula every amount in the snapshot comes from. The client's headline, the peer medians and
 * a peer's own estimated loss all pass through here, so the client and the peers beside it can
 * never be priced by different arithmetic.
 *
 * `trifr` below `ltifr` contributes no recordable term rather than a negative one: a company that
 * publishes a TRIFR under its LTIFR has counted differently, not fewer injuries than zero. Pure.
 */
export function lossOf({
  fte,
  ltifr,
  trifr,
  fatalities,
}: {
  readonly fte: number;
  readonly ltifr: number;
  readonly trifr: number;
  readonly fatalities: number;
}): { readonly ltis: number; readonly recordables: number; readonly loss: number } {
  const exposure = (rate: number) => (rate * fte * HOURS_PER_FTE) / 1_000_000;
  const ltis = exposure(ltifr);
  const recordables = exposure(Math.max(0, trifr - ltifr));
  return {
    ltis,
    recordables,
    loss:
      (ltis * HOURS_PER_LTI + recordables * HOURS_PER_RECORDABLE) * HOURLY_COST +
      fatalities * FATALITY_COST,
  };
}

/** The median of a non empty list, the mean of the two middle values on an even count. Pure. */
export function medianOf(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? 0) + upper) / 2;
}

/**
 * The client's standing on one rate (AC-13): the peers' count, their median and best value, the
 * client's rank as one plus the number of peers strictly better (so equal values share a rank) out
 * of that count plus one, and the gap to the median. Null rank and gap when the client published no
 * value for the rate. Lower is better for both rates. Null when no peer published the rate. Pure.
 */
export function standingOf(
  peerValues: readonly number[],
  clientValue: number | null,
): RateStanding | null {
  if (peerValues.length === 0) return null;
  const median = medianOf(peerValues);
  const best = Math.min(...peerValues);
  const ahead = clientValue === null ? 0 : peerValues.filter((value) => value < clientValue).length;
  return {
    count: peerValues.length,
    median,
    best,
    rank: clientValue === null ? null : ahead + 1,
    of: peerValues.length + 1,
    gapToMedian: clientValue === null ? null : clientValue - median,
  };
}

/**
 * The peers block (AC-13): every kept peer once with both its rates side by side and its own
 * estimated loss, sorted by LTIFR ascending with the peers lacking an LTIFR last, plus the standing
 * per rate at least one peer published. Null when the run kept no peer. Pure.
 */
export function peersBlockOf(
  rows: readonly ModelPeerRow[],
  clientValueOf: (key: RateKey) => number | null,
  thin: boolean,
): SnapshotPeers | null {
  if (rows.length === 0) return null;
  // One entry per peer name: the rows arrive one per rate, and a peer that published both rates
  // must appear once in the table (AC-13).
  const byName = new Map<string, ModelPeerRow[]>();
  for (const row of rows) {
    byName.set(row.peerName, [...(byName.get(row.peerName) ?? []), row]);
  }
  const peerRows: SnapshotPeerRow[] = [...byName.entries()].map(([peerName, rates]) => {
    const rateOf = (key: RateKey) => rates.find((rate) => rate.kpiKey === key) ?? null;
    const ltifr = rateOf("ltifr");
    const trifr = rateOf("trifr");
    // Newest of the peer's own rows: the two rates may come from different report years.
    const newest = rates.reduce((best, rate) => (rate.periodYear > best.periodYear ? rate : best));
    const headcount = rates.find((rate) => rate.headcount !== null)?.headcount ?? null;
    return {
      peerName,
      country: newest.country,
      headcount,
      periodYear: newest.periodYear,
      ltifr: ltifr?.value ?? null,
      trifr: trifr?.value ?? null,
      sourceUrl: (ltifr ?? newest).sourceUrl,
      // The weakest rate a row rests on: a table cell must not look better supported than the
      // figure behind it.
      confidence: Math.min(...rates.map((rate) => rate.confidence)),
      // A rate the peer did not publish counts as zero for its term (AC-13), so a peer with only a
      // TRIFR still prices its recordables and one with only an LTIFR still prices its lost time.
      estimatedLoss:
        headcount === null
          ? null
          : lossOf({
              fte: headcount,
              ltifr: ltifr?.value ?? 0,
              trifr: trifr?.value ?? 0,
              fatalities: 0,
            }).loss,
    };
  });
  const sorted = [...peerRows].sort((a, b) => {
    if (a.ltifr === null && b.ltifr === null) return a.peerName < b.peerName ? -1 : 1;
    if (a.ltifr === null) return 1;
    if (b.ltifr === null) return -1;
    if (a.ltifr !== b.ltifr) return a.ltifr - b.ltifr;
    return a.peerName < b.peerName ? -1 : 1;
  });
  const rates: Record<string, RateStanding> = {};
  for (const key of ["ltifr", "trifr"] as const) {
    const values = sorted.flatMap((row) => (row[key] === null ? [] : [row[key]]));
    const standing = standingOf(values, clientValueOf(key));
    if (standing) rates[key] = standing;
  }
  return { rung: rows[0]?.rung ?? "world", thin, rows: sorted, rates };
}

/**
 * The recommended package (AC-15), first match wins: a death or a large saving asks for the
 * retainer, no LTIFR at all asks for the safety management system since nothing can be priced,
 * worse than the median on both rates asks for compliance, on one for the system, and a company
 * better on both is sold culture. A rate absent from `peers.rates` counts as neither better nor
 * worse. The threshold is read in the snapshot's currency without conversion (AC-15). Pure.
 */
export function recommendationOf({
  fatalities,
  hasLtifr,
  savingAtMedian,
  worseCount,
}: {
  readonly fatalities: number;
  readonly hasLtifr: boolean;
  readonly savingAtMedian: number | null;
  readonly worseCount: number;
}): SnapshotRecommendation {
  if (fatalities > 0) return { packageKey: "retainer", reason: "fatality" };
  if (savingAtMedian !== null && savingAtMedian > LARGE_SAVING) {
    return { packageKey: "retainer", reason: "large_saving" };
  }
  if (!hasLtifr) return { packageKey: "sms", reason: "no_figures" };
  if (worseCount >= 2) return { packageKey: "compliance", reason: "both_worse" };
  if (worseCount === 1) return { packageKey: "sms", reason: "one_worse" };
  return { packageKey: "culture", reason: "both_better" };
}

/**
 * Computes the `benchmark-model@7` body for one company (AC-12): the inputs, the peers of the run
 * with their own estimated losses and the client's rank per rate, the loss the client's figures
 * imply with the saving at the peer median and at the best peer, and the recommended package.
 * Pure; the task validates and stores the result.
 */
export function computeBenchmark({ company, kpis, peers, thin = false }: ModelInput): SnapshotBody {
  // (1) Inputs: the newest row per loss KPI, each key chosen independently (AC-14).
  const fte = company.employeesCount;
  const rows = LOSS_KPIS.flatMap((key) => {
    const row = newestRow(kpis, key);
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
  const inputOf = (key: KpiKey) => inputKpis.find((input) => input.key === key) ?? null;
  const ltifr = inputOf("ltifr");
  const trifr = inputOf("trifr");
  const fatalityRow = inputOf("fatalities");
  const fatalities = fatalityRow?.value ?? 0;

  // (2) The peers of the run, with the client's own value deciding each rank (AC-13).
  const peersBlock = peersBlockOf(peers, (key) => inputOf(key)?.value ?? null, thin);

  // (3) The loss (AC-14). Null without a positive headcount or without an LTIFR: exposure and a
  // lost time rate are what the whole table rests on, and a zero is a figure, not their absence.
  let loss: SnapshotLoss | null = null;
  if (fte !== null && fte > 0 && ltifr) {
    const client = lossOf({
      fte,
      ltifr: ltifr.value,
      trifr: trifr?.value ?? 0,
      fatalities,
    });
    // The same formula with one rate replaced, the fatalities held: what this company would lose
    // at the peers' figures, not what a different company loses.
    const at = (pick: (standing: RateStanding) => number): number | null => {
      if (!peersBlock) return null;
      const ltifrStanding = peersBlock.rates.ltifr;
      const trifrStanding = peersBlock.rates.trifr;
      if (!ltifrStanding && !trifrStanding) return null;
      return lossOf({
        fte,
        ltifr: ltifrStanding ? pick(ltifrStanding) : ltifr.value,
        trifr: trifrStanding ? pick(trifrStanding) : (trifr?.value ?? 0),
        fatalities,
      }).loss;
    };
    const atMedian = at((standing) => standing.median);
    const atBest = at((standing) => standing.best);
    loss = {
      ltis: client.ltis,
      recordables: client.recordables,
      trifrMissing: trifr === null,
      fatalities,
      loss: client.loss,
      atMedian,
      atBest,
      savingAtMedian: atMedian === null ? null : Math.max(0, client.loss - atMedian),
      savingAtBest: atBest === null ? null : Math.max(0, client.loss - atBest),
    };
  }

  // (4) The recommendation (AC-15). "Worse" is measured per rate against the peer median, and only
  // for a rate the peers actually published and the client actually has.
  const worseOn = (key: RateKey): boolean => {
    const standing = peersBlock?.rates[key];
    const value = inputOf(key)?.value;
    return standing !== undefined && value !== undefined && value > standing.median;
  };
  const recommendation = recommendationOf({
    fatalities,
    hasLtifr: ltifr !== null,
    savingAtMedian: loss?.savingAtMedian ?? null,
    worseCount: (worseOn("ltifr") ? 1 : 0) + (worseOn("trifr") ? 1 : 0),
  });

  // (5) Scalars (AC-16). The confidence is the minimum over the client rows the loss actually used:
  // a null confidence counts 1 for a client entered row, which the client stands behind, and 0.5
  // for a research row, which nobody has checked.
  const lossRows = loss
    ? [ltifr, trifr, fatalityRow].filter((input): input is InputKpi => input !== null)
    : [];
  const confidences = lossRows.map((input) =>
    input.confidence === null ? (input.source === "client" ? 1 : 0.5) : input.confidence,
  );
  return {
    inputs: {
      fte,
      section: sectionOfDivision(company.industryCode),
      industryCode: company.industryCode,
      country: company.country,
      currency: company.currency,
      companyUpdatedAt: company.updatedAt,
      kpis: inputKpis,
    },
    peers: peersBlock,
    loss,
    recommendation,
    kpisCompared: peersBlock ? Object.keys(peersBlock.rates).length : 0,
    confidence: confidences.length > 0 ? Math.min(...confidences) : null,
    currency: company.currency,
    lossAmount: loss?.loss ?? null,
    savingAtMedian: loss?.savingAtMedian ?? null,
  };
}
