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

/** One axis tick: the value for geometry and its label, formatted by the server parent. */
export type Tick = { readonly value: number; readonly label: string };

/**
 * A round step for about `target` ticks over `span`: 1, 2, 2.5 or 5 times a power of ten, the
 * usual chart rule, so the axis reads 2.5, 5.0, 7.5 rather than the padded domain ends. Pure.
 */
export function niceStep(span: number, target: number): number {
  const raw = Math.abs(span) / Math.max(1, target);
  if (raw === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  const factor =
    residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10;
  return factor * magnitude;
}

/**
 * The round tick values inside a domain, about `target` of them, never outside it, so the
 * domain of `chartDomain` (AC-22) stays what it is and the ticks only annotate it. Pure.
 */
export function niceTicks([low, high]: Domain, target = 5): readonly number[] {
  const step = niceStep(high - low, target);
  const first = Math.ceil(low / step) * step;
  const count = Math.max(0, Math.floor((high - first) / step + 1e-9) + 1);
  return Array.from({ length: count }, (_, index) => Number((first + index * step).toFixed(10)));
}

/** How many decimals a tick list needs so every tick prints exactly (2.5 needs one, 20 none). Pure. */
export function tickDecimals(ticks: readonly number[]): number {
  return ticks.reduce((most, value) => {
    const text = String(value);
    const dot = text.indexOf(".");
    return Math.max(most, dot === -1 ? 0 : text.length - dot - 1);
  }, 0);
}
