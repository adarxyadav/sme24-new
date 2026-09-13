/**
 * The bubble chart's scale rules (spec 0021, AC-22), pure and shared by the server parent that
 * formats the axis labels and the client component that draws: both read one domain so the two
 * can never disagree. No formatting here; the numbers are geometry only.
 */

/** A linear axis domain. */
export type Domain = readonly [low: number, high: number];

/**
 * The `PeerStrip` rule (spec 0021, AC-10, AC-22): the minimum and maximum over every value the
 * axis has to show, widened by 8 percent of the span on each side, so a bubble or the sector line
 * at an extreme is never clipped. A single value gets a span of one. Pure.
 */
export function chartDomain(values: readonly number[]): Domain {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const margin = span * 0.08;
  return [low - margin, high + margin];
}

/** The largest and the floor bubble radius in viewBox units (AC-22: area, not radius, with a floor). */
export const BUBBLE_RADIUS_MAX = 26;
export const BUBBLE_RADIUS_MIN = 7;

/**
 * A bubble's radius so that its area is proportional to `headcount` against the largest headcount
 * on the chart, never below the floor, and the floor alone when the headcount is unknown (the
 * client without an FTE, owner call of 13 Sep 2026). Pure.
 */
export function bubbleRadius(headcount: number | null, largest: number): number {
  if (headcount === null || headcount <= 0 || largest <= 0) return BUBBLE_RADIUS_MIN;
  return Math.max(BUBBLE_RADIUS_MIN, BUBBLE_RADIUS_MAX * Math.sqrt(headcount / largest));
}
