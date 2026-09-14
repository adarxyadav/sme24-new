/**
 * The loss constants of the owner's table (spec 0022, AC-14). Five numbers, no database row and no
 * curator: a lost time injury costs 769 working hours, a further recordable injury 201, an hour of
 * work 75 in the company's own currency and a death 1 200 000. They replace the seven stored
 * assumptions of spec 0008, which went with the curated tables (AC-19).
 *
 * Two of them are never rendered anywhere (AC-14): the hourly cost and the fatality price are
 * inputs to one figure the client reads as money, not prices we quote back at them.
 *
 * The amounts are read in the snapshot's currency without conversion, the known simplification the
 * spec records as a Follow-up: a client in the euro area prices a death at 1 200 000 euros.
 */

/** Working hours one full time equivalent covers in a year; the denominator every rate is quoted against. */
export const HOURS_PER_FTE = 1800;

/** Working hours one lost time injury costs, absence and handling together. */
export const HOURS_PER_LTI = 769;

/** Working hours one further recordable injury costs, the ones that did not cost lost time. */
export const HOURS_PER_RECORDABLE = 201;

/** The cost of one working hour, in the company's currency. Never rendered (AC-14). */
export const HOURLY_COST = 75;

/** The cost of one death, in the company's currency. Never rendered (AC-14). */
export const FATALITY_COST = 1_200_000;

/** The saving above which the standing recommends the retainer (AC-15), in the snapshot's currency. */
export const LARGE_SAVING = 250_000;

/**
 * Rounds an amount for display and for the email (spec 0016, AC-9, renamed from `roundChf` by spec
 * 0022 AC-14 now that the currency is the company's own): nearest 100 below 10 000, else nearest
 * 1 000. Money is stored unrounded and rounded once, here, so the card and the email can never
 * disagree for one snapshot. Pure.
 */
export function roundMoney(value: number): number {
  const step = Math.abs(value) < 10_000 ? 100 : 1_000;
  return Math.round(value / step) * step;
}
