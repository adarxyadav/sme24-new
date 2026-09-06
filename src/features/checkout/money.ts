/**
 * Money for the checkout (spec 0011, AC-2, AC-15). Every amount in this feature is a whole
 * number of Rappen held as a JavaScript integer: CHF 2'000.00 is 200_000. No amount is ever a
 * float, a decimal string or a `numeric`, in the database, in transit or here, which removes the
 * whole class of currency rounding bugs at the type level rather than testing for them.
 *
 * Stripe's minor unit for CHF is the Rappen too, so a Rappen integer passes to `unit_amount`
 * unchanged. The only division by 100 in the whole feature happens at the display boundary, in
 * `rappenToChf` below, feeding the next-intl `chf` format.
 *
 * Pure: no I/O, no clock, no environment.
 */

/** One Swiss franc in Rappen. */
export const RAPPEN_PER_CHF = 100;

/** The three amounts of an order, all whole Rappen. */
export type Amounts = {
  readonly netRappen: number;
  readonly vatRate: number;
  readonly vatRappen: number;
  readonly grossRappen: number;
};

/**
 * True when the value is a whole number of Rappen a money column may hold: an integer, finite,
 * not negative and inside the safe integer range. Pure.
 */
export function isRappen(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Rounds to the nearest whole Rappen, halves away from zero. `Math.round` rounds -0.5 to -0
 * (towards positive infinity), which would bias a negative amount; amounts here are never
 * negative, but the helper stays symmetric so a future credit note cannot inherit a silent bias.
 * Pure.
 */
export function roundRappen(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Derives the VAT and gross of a net price, the single arithmetic both payment paths share
 * (spec 0011, Value sourcing). `vatRappen` is `netRappen * vatRate` rounded to the nearest whole
 * Rappen and `grossRappen` is their exact sum, which is also the database check constraint, so
 * this function and the column can never disagree. Throws on an input that is not a usable net
 * price or rate, because a bad amount must never reach an order row. Pure.
 */
export function computeAmounts(netRappen: number, vatRate: number): Amounts {
  if (!isRappen(netRappen) || netRappen <= 0) {
    throw new Error(`net price must be a positive whole number of Rappen, got ${netRappen}`);
  }
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate >= 1) {
    throw new Error(`vat rate must be a fraction between 0 and 1, got ${vatRate}`);
  }
  const vatRappen = roundRappen(netRappen * vatRate);
  return {
    netRappen,
    vatRate,
    vatRappen,
    grossRappen: netRappen + vatRappen,
  };
}

/**
 * Converts whole Rappen to a CHF number for display only, the one place a money value becomes a
 * fraction. Feed the result to the next-intl `chf` format; never store it, never send it to
 * Stripe and never compute with it. Pure.
 */
export function rappenToChf(rappen: number): number {
  return rappen / RAPPEN_PER_CHF;
}

/**
 * Converts a whole franc price (the CHF numbers in `src/features/marketing/packages.ts`) to
 * Rappen, for the catalogue equality test and the seed. Throws on a value that is not a whole
 * number of Rappen once multiplied, so a price like 19.999 cannot silently truncate. Pure.
 */
export function chfToRappen(chf: number): number {
  const rappen = Math.round(chf * RAPPEN_PER_CHF);
  if (Math.abs(chf * RAPPEN_PER_CHF - rappen) > Number.EPSILON * RAPPEN_PER_CHF) {
    throw new Error(`price ${chf} CHF is not a whole number of Rappen`);
  }
  return rappen;
}

/**
 * Swiss cash rounding to the nearest 5 Rappen (spec 0004, spec 0011 AC-15). Switzerland has no
 * 1 or 2 Rappen coin, so a cash total is shown to the nearest 0.05.
 *
 * DISPLAY ONLY, and only where the amount is presented as a cash figure. It is never applied to a
 * stored amount, to what Stripe charges, or to anything printed on the invoice: an invoice is
 * paid by card or by bank transfer, both of which settle the exact Rappen, and rounding an
 * invoice total would put the document out of step with the payment. Pure.
 */
export function roundToFiveRappen(rappen: number): number {
  return roundRappen(rappen / 5) * 5;
}
