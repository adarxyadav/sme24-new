import { KPI_CATALOGUE, type KpiKey } from "@/features/research/catalogue";
import { currentYear } from "@/features/self-assessment/years";
import { isEuropean, regionOf } from "@/lib/countries";
import {
  type AssumptionKey,
  COST_LINKED_KPIS,
  type GeoRung,
  PEER_CHART_LIMIT,
  PEER_KPI_KEYS,
  PEER_MINIMUM,
  PEER_YEARS_BACK,
  type PeerKpiKey,
  type SizeBand,
  sectionOfDivision,
  sizeBandOf,
} from "./catalogue";
import type { PeerBasis, PublishedUnit } from "./seed-schema";
import {
  type AssumptionUsedV3,
  type CostSkipped,
  type DerivedCount,
  type DerivedFromKey,
  type InputKpi,
  type Position,
  peerShapeOf,
  type SnapshotBody,
  type SnapshotCost,
  type SnapshotDerived,
  type SnapshotGap,
  type SnapshotPeer,
  type SnapshotPeerBlock,
  type SnapshotPeerRow,
  type SnapshotPeerV3,
  type SnapshotResultV4,
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
  /** `companies.country` (spec 0021, AC-6): the ladder's first rung; a code outside the catalogue lands on `world`. */
  readonly country: string;
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
  /** The source's own classification (spec 0016), for example `Suva class 22A`. */
  readonly sourceKey?: string | null;
  /** What the quartiles actually describe, shown to the client (spec 0016). */
  readonly basis?: { readonly de: string; readonly en: string } | null;
};

export type ModelAssumption = AssumptionUsedV3;

/** A `peer_companies` row as the task loads it (spec 0021, AC-5): one NACE section, never widened. */
export type ModelPeerCompany = {
  readonly key: string;
  readonly name: string;
  readonly country: string;
  readonly industrySection: string;
  readonly headcount: number;
  readonly headcountYear: number;
  readonly reportUrl: string;
};

/** A verified `peer_figures` row as the task loads it; the task filters `verified_at is not null` (AC-5). */
export type ModelPeerFigure = {
  readonly peerKey: string;
  readonly kpiKey: PeerKpiKey;
  readonly periodYear: number;
  readonly value: number;
  readonly valueAsPublished: number;
  readonly unitAsPublished: PublishedUnit;
  readonly basis: PeerBasis;
  readonly sourceUrl: string;
  readonly verifiedAt: string;
};

/** The named peer library of the company's section (spec 0021). */
export type ModelPeerLibrary = {
  readonly companies: readonly ModelPeerCompany[];
  readonly figures: readonly ModelPeerFigure[];
};

export type ModelInput = {
  readonly company: ModelCompany;
  readonly catalogue: readonly ModelCatalogueEntry[];
  readonly kpis: readonly ModelKpiRow[];
  readonly peers: readonly ModelPeerRow[];
  readonly assumptions: readonly ModelAssumption[];
  /** The named published peers of the section (spec 0021); absent means an empty library. */
  readonly library?: ModelPeerLibrary;
  /** The clock for the freshness rule (spec 0021, AC-6); the task leaves it to `new Date()`. */
  readonly now?: Date;
};

/** Rounds a CHF amount for display and the email (AC-18 rule 8): nearest 100 below 10 000, else nearest 1 000. Pure. */
export function roundChf(value: number): number {
  const step = Math.abs(value) < 10_000 ? 100 : 1_000;
  return Math.round(value / step) * step;
}

/**
 * Rounds a cost range outward at the same step `roundChf` uses (spec 0016, AC-9): the low end
 * down, the high end up, so the displayed band always contains the computed one and the shown
 * range can never be narrower than the arithmetic. The card and the email both call this, so the
 * two surfaces never show different numbers for one snapshot (AC-13). Both ends are non negative
 * by construction, so no behaviour below zero is defined. Pure.
 */
export function roundChfRange(
  low: number,
  high: number,
): { readonly low: number; readonly high: number } {
  const stepOf = (value: number) => (Math.abs(value) < 10_000 ? 100 : 1_000);
  return {
    low: Math.floor(low / stepOf(low)) * stepOf(low),
    high: Math.ceil(high / stepOf(high)) * stepOf(high),
  };
}

/** The denominator of the Eurostat fatal accident rate: deaths per 100 000 employed persons. */
export const FATALITY_RATE_PER = 100_000;

/**
 * The company's fatality count as a rate per 100 000 employed persons, the unit the peer row is
 * stored in (spec 0016 amendment, D3). Null without a positive headcount: a count cannot become a
 * rate without exposure, so the KPI is then not compared at all rather than compared wrongly. Pure.
 */
export function fatalityRateOf(count: number, fte: number | null): number | null {
  return fte !== null && fte > 0 ? (count / fte) * FATALITY_RATE_PER : null;
}

/**
 * The value a KPI's position is judged on (spec 0016 amendment, AC-22, AC-23): the stored value
 * for every KPI but `fatalities`, whose count is converted to the peer row's rate. `converted`
 * says whether the value differs from the stored one, so the snapshot records it only then.
 * Null means the KPI cannot be compared at all (a fatality count with no headcount). Pure.
 */
export function comparedValueOf(
  key: KpiKey,
  value: number,
  fte: number | null,
): { readonly value: number; readonly converted: boolean } | null {
  if (key !== "fatalities") return { value, converted: false };
  const rate = fatalityRateOf(value, fte);
  return rate === null ? null : { value: rate, converted: true };
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
): SnapshotPeerV3 | null {
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
      // Derived from the values, never a stored column (spec 0016, AC-4).
      shape: peerShapeOf(chosen),
      sourceKey: chosen.sourceKey ?? null,
      basis: chosen.basis ?? null,
    };
  }
  return null;
}

/**
 * The position band of a value against the peer row (AC-4 rule 3, spec 0016 AC-5). A `point` row
 * holds one figure repeated as all three quartiles, so it can only say better or worse than that
 * figure: the four quartile bands are unreachable for it by construction rather than by wording.
 * The ISO branch is routed through the same rule, because a certified share is one number and is
 * therefore always a point row. Pure.
 */
export function positionOf(
  key: KpiKey,
  direction: ModelCatalogueEntry["direction"],
  value: number,
  peer: Pick<SnapshotPeer, "p25" | "median" | "p75">,
): Position {
  const shape = peerShapeOf(peer);
  if (key === "iso_45001_certified") {
    if (shape === "point") return value >= 1 ? "above_average" : "below_average";
    return value >= 1 ? "above_median" : "below_median";
  }
  if (shape === "point") {
    const atLeastAsGood =
      direction === "higher_is_better" ? value >= peer.median : value <= peer.median;
    return atLeastAsGood ? "above_average" : "below_average";
  }
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

/** The exposure basis a rate is quoted against; picks the arm of `exposureCount`. */
export type RateShape = "per_1000_fte" | "per_million_hours";

/**
 * Turns a rate into a yearly count of incidents (spec 0012, AC-9). The only place a rate becomes
 * a count: the cost line calls it for `incidents` and the derived block calls it for its counts,
 * so the two can never disagree. Dispatches on the rate's shape rather than on a KPI key, so
 * TRIFR takes the same per million hours arm as LTIFR. Pure.
 */
export function exposureCount(
  shape: RateShape,
  rate: number,
  fte: number,
  hoursPerFte: number,
): number {
  return shape === "per_1000_fte" ? (rate * fte) / 1000 : (rate * fte * hoursPerFte) / 1_000_000;
}

/** The shape each rate KPI is quoted against (spec 0012). Pure. */
export function rateShapeOf(key: DerivedFromKey): RateShape {
  return key === "accident_rate_per_1000_fte" ? "per_1000_fte" : "per_million_hours";
}

/** One evaluation of the cost formula (AC-18 rule 5). Pure. */
function costAt(
  incidentKpi: "accident_rate_per_1000_fte" | "ltifr",
  rate: number,
  fte: number,
  lostDays: number,
  values: Record<AssumptionKey, number>,
  multiplier: number,
): CostParts {
  const incidents = exposureCount(rateShapeOf(incidentKpi), rate, fte, values.hours_per_fte);
  const costPerCase = values.direct_cost_per_case_chf + lostDays * values.cost_per_absence_day_chf;
  return { incidents, lostDays, costPerCase, annual: incidents * costPerCase * multiplier };
}

/**
 * The first assumption the cost arm needs that is absent or not finite (spec 0016 amendment,
 * AC-20). `values` is built from whatever rows the database returned, so a key can read back
 * `undefined` at runtime while its type says `number`; this guard is what keeps `NaN` out of the
 * CHF figure, and it must not be simplified away on the strength of the type. Pure.
 */
function missingAssumption(
  keys: readonly AssumptionKey[],
  values: Partial<Record<AssumptionKey, number>>,
): AssumptionKey | null {
  return (
    keys.find((key) => {
      const value = values[key];
      return typeof value !== "number" || !Number.isFinite(value);
    }) ?? null
  );
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

/** One named peer on a rung: the company and the one figure kept for it. */
export type NamedPeer = {
  readonly company: ModelPeerCompany;
  readonly figure: ModelPeerFigure;
};

/**
 * One kept figure per company for a KPI (spec 0021, AC-6): figures from the current year minus
 * three or later, the latest year per company, and within that year the `employees` basis when
 * both bases exist. A company with only a contractor inclusive figure keeps that one. Pure.
 */
export function keptFigures(
  library: ModelPeerLibrary,
  key: PeerKpiKey,
  year: number,
): readonly NamedPeer[] {
  const floor = year - PEER_YEARS_BACK;
  const companyOf = new Map(library.companies.map((company) => [company.key, company]));
  const fresh = library.figures.filter(
    (figure) =>
      figure.kpiKey === key && figure.periodYear >= floor && companyOf.has(figure.peerKey),
  );
  const byCompany = new Map<string, ModelPeerFigure>();
  for (const figure of fresh) {
    const current = byCompany.get(figure.peerKey);
    const wins =
      current === undefined ||
      figure.periodYear > current.periodYear ||
      (figure.periodYear === current.periodYear &&
        figure.basis === "employees" &&
        current.basis !== "employees");
    if (wins) byCompany.set(figure.peerKey, figure);
  }
  return [...byCompany.values()]
    .map((figure) => ({ company: companyOf.get(figure.peerKey) as ModelPeerCompany, figure }))
    .sort((a, b) => (a.company.key < b.company.key ? -1 : 1));
}

/**
 * The geography ladder (spec 0021, AC-6): the client's country, then its region, then Europe,
 * then the world; the first rung holding at least three companies wins and every company on it
 * is a peer. A client country outside the catalogue empties the first three rungs and lands on
 * `world`. Null when even the world holds fewer than three. The industry never widens: the
 * library handed in is already one section. Pure.
 */
export function climbLadder(
  peers: readonly NamedPeer[],
  clientCountry: string,
): { readonly geoRung: GeoRung; readonly peers: readonly NamedPeer[] } | null {
  const region = regionOf(clientCountry);
  // The first three rungs are the client's home ground: a client outside the catalogue has no
  // country, region or Europe rung and lands on the world with every peer (AC-6).
  const european = isEuropean(clientCountry);
  const rungs: ReadonlyArray<readonly [GeoRung, (peer: NamedPeer) => boolean]> = [
    ["country", (peer) => peer.company.country === clientCountry],
    ["region", (peer) => region !== null && regionOf(peer.company.country) === region],
    ["europe", (peer) => european && isEuropean(peer.company.country)],
    ["world", () => true],
  ];
  for (const [geoRung, holds] of rungs) {
    const onRung = peers.filter(holds);
    if (onRung.length >= PEER_MINIMUM) return { geoRung, peers: onRung };
  }
  return null;
}

/**
 * The client's rank among the peers (spec 0021, AC-7): one plus the number of peers strictly
 * better, so equal values share a rank; the best peer's key, the lowest key on a tie; and the
 * client's value minus the best peer's value in the KPI's unit. Pure.
 */
export function rankAmong(
  direction: ModelCatalogueEntry["direction"],
  clientValue: number | null,
  peers: readonly NamedPeer[],
): {
  readonly rank: number | null;
  readonly best: string | null;
  readonly gapToBest: number | null;
} {
  const better = (a: number, b: number) => (direction === "higher_is_better" ? a > b : a < b);
  const best = peers.reduce<NamedPeer | null>((winner, peer) => {
    if (winner === null || better(peer.figure.value, winner.figure.value)) return peer;
    if (peer.figure.value === winner.figure.value && peer.company.key < winner.company.key)
      return peer;
    return winner;
  }, null);
  if (best === null) return { rank: null, best: null, gapToBest: null };
  if (clientValue === null) return { rank: null, best: best.company.key, gapToBest: null };
  const ahead = peers.filter((peer) => better(peer.figure.value, clientValue)).length;
  return { rank: ahead + 1, best: best.company.key, gapToBest: clientValue - best.figure.value };
}

/**
 * The chart's peers (spec 0021, AC-9): the LTIFR block's peers that also have a lost days figure
 * in the library, at most six, nearest headcount to the client's FTE, ties to the latest year and
 * then the key. Empty without an LTIFR block. Pure.
 */
export function chartPeerKeys(
  ltifrPeers: readonly NamedPeer[],
  library: ModelPeerLibrary,
  fte: number | null,
): string[] {
  const withLostDays = new Set(
    library.figures
      .filter((figure) => figure.kpiKey === "lost_days_per_incident")
      .map((figure) => figure.peerKey),
  );
  const distance = (peer: NamedPeer) => (fte === null ? 0 : Math.abs(peer.company.headcount - fte));
  return ltifrPeers
    .filter((peer) => withLostDays.has(peer.company.key))
    .sort((a, b) => {
      const byDistance = distance(a) - distance(b);
      if (byDistance !== 0) return byDistance;
      if (a.figure.periodYear !== b.figure.periodYear)
        return b.figure.periodYear - a.figure.periodYear;
      return a.company.key < b.company.key ? -1 : 1;
    })
    .slice(0, PEER_CHART_LIMIT)
    .map((peer) => peer.company.key);
}

/** Sorts peers best first for the table, ties by key (spec 0021, AC-10). Pure. */
function bestFirst(
  direction: ModelCatalogueEntry["direction"],
  peers: readonly NamedPeer[],
): readonly NamedPeer[] {
  return [...peers].sort((a, b) => {
    if (a.figure.value !== b.figure.value) {
      return direction === "higher_is_better"
        ? b.figure.value - a.figure.value
        : a.figure.value - b.figure.value;
    }
    return a.company.key < b.company.key ? -1 : 1;
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
  library = { companies: [], figures: [] },
  now = new Date(),
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

  // (2) to (4) and (7) per KPI: peer, position, gap, confidence. A fatality count is judged as a
  // rate per 100 000 employed persons (D3); with no headcount it has no comparison at all.
  const results: SnapshotResultV4[] = inputKpis.map((input) => {
    const compared = comparedValueOf(input.key, input.value, fte);
    const peer = compared
      ? selectPeer(peers, input.key, section, sizeBand, input.periodYear)
      : null;
    if (!peer || !compared) {
      return {
        key: input.key,
        peer: null,
        position: null,
        gapToMedian: null,
        gapRelative: null,
        confidence: input.confidence,
        comparedValue: null,
      };
    }
    const gap = gapOf(input.key, direction(input.key), compared.value, peer.median);
    return {
      key: input.key,
      peer,
      position: positionOf(input.key, direction(input.key), compared.value, peer),
      gapToMedian: gap.gapToMedian,
      gapRelative: gap.gapRelative,
      confidence: input.confidence,
      comparedValue: compared.converted ? compared.value : null,
    };
  });
  const resultOf = (key: KpiKey) => results.find((result) => result.key === key);
  const inputOf = (key: KpiKey) => inputKpis.find((input) => input.key === key);

  // (5) Cost.
  // `assumptions` holds whatever rows the database returned, so any key whose row is absent reads
  // back `undefined` at runtime. `missingAssumption` checks every key an arm needs before the
  // arithmetic runs (AC-20), and the derived block keeps its own `typeof` guard below; neither
  // may be "simplified" away on the strength of the cast.
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
  let costSkipped: CostSkipped | null = null;
  // The assumptions this arm reads: the hours only on the LTIFR arm, the default lost days only
  // without a lost days row. One missing or non finite value means no cost and a named reason.
  const neededAssumptions: readonly AssumptionKey[] = [
    "direct_cost_per_case_chf",
    "cost_per_absence_day_chf",
    "indirect_multiplier_low",
    "indirect_multiplier",
    "indirect_multiplier_high",
    ...(incidentKpi === "ltifr" ? (["hours_per_fte"] as const) : []),
    ...(lostDaysInput ? [] : (["lost_days_per_incident_default"] as const)),
  ];
  const missing =
    fte && fte > 0 && incidentInput && incidentKpi
      ? missingAssumption(neededAssumptions, values)
      : null;
  if (missing) costSkipped = { reason: "missing_assumption", key: missing };
  if (fte && fte > 0 && incidentInput && incidentKpi && !missing) {
    const lostDays = lostDaysInput ? lostDaysInput.value : values.lost_days_per_incident_default;
    const lostDaysSource: SnapshotCost["lostDaysSource"] = lostDaysInput ? "kpi" : "default";
    const at = (rate: number, days: number, multiplier: number) =>
      costAt(incidentKpi, rate, fte, days, values, multiplier);
    const main = at(incidentInput.value, lostDays, values.indirect_multiplier);
    const low = at(incidentInput.value, lostDays, values.indirect_multiplier_low).annual;
    const high = at(incidentInput.value, lostDays, values.indirect_multiplier_high).annual;
    const incidentPeer = resultOf(incidentKpi)?.peer ?? null;
    const lostDaysPeer = resultOf("lost_days_per_incident")?.peer ?? null;
    // Null only without a peer row (spec 0016 amendment, D1): a peer value of 0 is a real
    // reference that prices to zero incidents, so the saving is then the whole annual cost.
    const reference = (quartile: "median" | "p25"): number | null => {
      if (!incidentPeer) return null;
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

  // (6b) The derived injury counts (spec 0012): display only, from the same exposure helper the
  // cost line uses, so the two can never disagree. Never a KPI row, never peer compared.
  const hoursPerFte = values.hours_per_fte;
  const trifr = inputOf("trifr");
  // LTIFR first, then the Suva accident rate as fallback: this is the reader's lost time figure,
  // chosen independently of the cost line's own precedence.
  const lostTimeInput = ltifr ?? accidentRate ?? null;
  const derivedFrom = (
    input: InputKpi,
    key: DerivedFromKey,
    exposureFte: number,
  ): DerivedCount => ({
    count: exposureCount(rateShapeOf(key), input.value, exposureFte, hoursPerFte),
    fromKey: key,
    fromValue: input.value,
    fromSource: input.source,
    fromYear: input.periodYear,
  });
  let derived: SnapshotDerived | null = null;
  // No exposure without a positive headcount, and no arithmetic without the hours assumption:
  // an absent row must leave the block absent rather than store NaN (AC-7, AC-16).
  if (fte !== null && fte > 0 && typeof hoursPerFte === "number" && Number.isFinite(hoursPerFte)) {
    const lostTime = lostTimeInput
      ? derivedFrom(lostTimeInput, ltifr ? "ltifr" : "accident_rate_per_1000_fte", fte)
      : null;
    const recordable = trifr ? derivedFrom(trifr, "trifr", fte) : null;
    if (lostTime || recordable) {
      derived = { fte, hoursPerFte, lostTime, recordable };
      // The disclosure must name the hours assumption whenever a count used it, including on the
      // Suva path where the cost line would not have recorded it (AC-11).
      usedAssumptionKeys.add("hours_per_fte");
    }
  }

  // (6c) The named published peers (spec 0021): per KPI of the four, the kept figures, the
  // ladder, the rank and the client's own saving at each peer, priced inside this function with
  // the same `costAt` the cost line used and never re derived from the stored block (AC-8).
  const year = currentYear(now);
  const peerBlocks: SnapshotPeerBlock[] = [];
  const ladderOf = new Map<PeerKpiKey, readonly NamedPeer[]>();
  for (const key of PEER_KPI_KEYS) {
    const climbed = climbLadder(keptFigures(library, key, year), company.country);
    if (climbed) ladderOf.set(key, climbed.peers);
    if (!climbed) continue;
    const clientValue = inputOf(key)?.value ?? null;
    const ordered = bestFirst(direction(key), climbed.peers);
    const ranked =
      key === "iso_45001_certified"
        ? { rank: null, best: null, gapToBest: null }
        : rankAmong(direction(key), clientValue, ordered);
    const certifiedShare =
      key === "iso_45001_certified"
        ? ordered.filter((peer) => peer.figure.value >= 1).length / ordered.length
        : null;
    // The saving at a peer (AC-8): LTIFR on the per million hours arm on both sides, lost days
    // with the client's incidents on both sides; nothing for TRIFR and ISO, and nothing at all
    // when the snapshot's cost is null or skipped. The LTIFR arm needs the hours assumption even
    // when the headline priced the Suva arm without it.
    const hoursKnown =
      typeof values.hours_per_fte === "number" && Number.isFinite(values.hours_per_fte);
    const savingAt = (peerValue: number): SnapshotPeerRow["savingAtPeer"] => {
      if (!cost || !incidentKpi || !incidentInput || !fte || fte <= 0) return null;
      let saving: number | null = null;
      if (key === "ltifr" && ltifr && hoursKnown) {
        const at = (rate: number) =>
          costAt("ltifr", rate, fte, cost.lostDays, values, values.indirect_multiplier).annual;
        saving = at(ltifr.value) - at(peerValue);
      } else if (key === "lost_days_per_incident" && lostDaysInput) {
        const at = (days: number) =>
          costAt(incidentKpi, incidentInput.value, fte, days, values, values.indirect_multiplier)
            .annual;
        saving = at(lostDaysInput.value) - at(peerValue);
      }
      if (saving === null) return null;
      return saving <= 0 ? "already_ahead" : saving;
    };
    peerBlocks.push({
      key,
      geoRung: climbed.geoRung,
      ...ranked,
      certifiedShare,
      chart: { peerKeys: [] },
      rows: ordered.map(({ company: peerCompany, figure }) => ({
        peerKey: peerCompany.key,
        name: peerCompany.name,
        country: peerCompany.country,
        headcount: peerCompany.headcount,
        headcountYear: peerCompany.headcountYear,
        periodYear: figure.periodYear,
        value: figure.value,
        valueAsPublished: figure.valueAsPublished,
        unitAsPublished: figure.unitAsPublished,
        basis: figure.basis,
        sourceUrl: figure.sourceUrl,
        reportUrl: peerCompany.reportUrl,
        verifiedAt: figure.verifiedAt,
        savingAtPeer: savingAt(figure.value),
      })),
    });
  }
  const ltifrBlock = peerBlocks.find((block) => block.key === "ltifr");
  const peerBlocksWithChart: SnapshotPeerBlock[] = peerBlocks.map((block) =>
    block === ltifrBlock
      ? { ...block, chart: { peerKeys: chartPeerKeys(ladderOf.get("ltifr") ?? [], library, fte) } }
      : block,
  );

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
      country: company.country,
      companyUpdatedAt: company.updatedAt,
      kpis: inputKpis,
    },
    results,
    gaps,
    cost,
    assumptions: usedAssumptions,
    derived,
    peers: peerBlocksWithChart,
    kpisCompared: results.filter((result) => result.peer !== null).length,
    peerProvisional,
    confidence,
    costChf: cost?.annual ?? null,
    costLowChf: cost?.low ?? null,
    costHighChf: cost?.high ?? null,
    savingMedianChf: cost?.savingMedian ?? null,
    savingTopChf: cost?.savingTop ?? null,
    costSkipped,
  };
}
