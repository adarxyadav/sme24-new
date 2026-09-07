import type { Position } from "@/features/benchmark/snapshot";
import type { PackageKey } from "@/features/marketing/packages";
import type { KpiKey } from "@/features/research/catalogue";

/**
 * The example benchmark the landing hero shows (spec 0009, hero amendment of 2026-09-07): one
 * fictional Swiss metal products company, Muster AG, against the real all industries BUV median
 * of 61.8 accidents per 1 000 FTE. The shape mirrors a `benchmark_snapshots` row so the hero
 * object and the dashboard read the same way; the figures are illustrative and never come from
 * a customer. Pure data.
 */

export type HeroQuartiles = {
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
};

export type HeroPosition = {
  readonly key: KpiKey;
  readonly value: number;
  /** `null` while the peer table has no row for this KPI. */
  readonly quartiles: HeroQuartiles | null;
  readonly band: Position | null;
};

export type HeroGap = {
  readonly key: KpiKey;
  readonly value: number;
  readonly median: number;
  /** The distance above the median as a fraction (0.84 is 84%). */
  readonly relative: number;
  readonly savingChf: number;
};

export const HERO_EXAMPLE = {
  computedOn: new Date("2026-09-07T00:00:00Z"),
  section: "C",
  sizeBand: "50-249",
  peerYear: 2024,
  peerSample: 41,
  compared: 6,
  total: 8,
  cost: {
    estimateChf: 184_000,
    lowChf: 121_000,
    highChf: 262_000,
    savingMedianChf: 41_000,
    savingTopChf: 96_000,
    confidenceFrom: "ltifr",
  },
  gaps: [
    { key: "ltifr", value: 9.4, median: 5.1, relative: 0.84, savingChf: 31_000 },
    {
      key: "accident_rate_per_1000_fte",
      value: 78.2,
      median: 61.8,
      relative: 0.27,
      savingChf: 8_000,
    },
    { key: "absenteeism_rate", value: 4.9, median: 3.6, relative: 0.36, savingChf: 2_000 },
  ],
  positions: [
    {
      key: "ltifr",
      value: 9.4,
      quartiles: { p25: 2.9, median: 5.1, p75: 8.2 },
      band: "bottom_quarter",
    },
    {
      key: "trifr",
      value: 21.7,
      quartiles: { p25: 9.8, median: 16.4, p75: 24.9 },
      band: "below_median",
    },
    { key: "fatalities", value: 0, quartiles: { p25: 0, median: 0, p75: 0 }, band: "top_quarter" },
    {
      key: "lost_days_per_incident",
      value: 12.5,
      quartiles: { p25: 9, median: 15, p75: 23 },
      band: "above_median",
    },
    {
      key: "accident_rate_per_1000_fte",
      value: 78.2,
      quartiles: { p25: 44, median: 61.8, p75: 88 },
      band: "below_median",
    },
    {
      key: "absenteeism_rate",
      value: 4.9,
      quartiles: { p25: 2.8, median: 3.6, p75: 5.4 },
      band: "below_median",
    },
    { key: "near_miss_rate", value: 3.1, quartiles: null, band: null },
    { key: "iso_45001_certified", value: 0, quartiles: null, band: null },
  ],
  /** The share of the peer group that holds ISO 45001, for the certification row. */
  peersCertified: 0.38,
  nextStep: "sms",
} as const satisfies {
  readonly computedOn: Date;
  readonly section: string;
  readonly sizeBand: string;
  readonly peerYear: number;
  readonly peerSample: number;
  readonly compared: number;
  readonly total: number;
  readonly cost: {
    readonly estimateChf: number;
    readonly lowChf: number;
    readonly highChf: number;
    readonly savingMedianChf: number;
    readonly savingTopChf: number;
    readonly confidenceFrom: KpiKey;
  };
  readonly gaps: readonly HeroGap[];
  readonly positions: readonly HeroPosition[];
  readonly peersCertified: number;
  readonly nextStep: PackageKey;
};

/** Where the marker and the three quartile ticks sit on the track, in percent of its width. */
export type TrackLayout = {
  readonly p25: number;
  readonly median: number;
  readonly p75: number;
  readonly marker: number;
};

/**
 * Lays a value out on a quartile track: p25, the median and p75 sit at a quarter, the middle and
 * three quarters of the width, and the value is placed on the same linear scale, held inside the
 * track (4% to 96%) so an outlier still shows at the edge. A peer group whose quartiles coincide
 * (every peer at zero) has no scale, so a value at or under the median sits on the p25 tick,
 * where the top quarter starts, and anything above it goes to the far edge. Pure.
 */
export function trackLayout(value: number, { p25, median, p75 }: HeroQuartiles): TrackLayout {
  const span = p75 - p25;
  const raw = span > 0 ? 50 + ((value - median) / span) * 50 : value <= median ? 25 : 96;
  const marker = Math.min(96, Math.max(4, raw));
  return { p25: 25, median: 50, p75: 75, marker };
}
