import type { useFormatter } from "next-intl";
import { rappenToChf } from "@/features/checkout/money";

/**
 * Money display (spec 0011, AC-15). The one place Rappen become a CHF figure: everything above
 * this line works in whole Rappen, and the division happens here, at the display boundary, feeding
 * the next-intl `chf` format so both catalogs render `CHF 2'162.00` their own way.
 *
 * Never used to compute anything, and never applied to what Stripe charges or what an invoice
 * totals. Pure.
 */
export function formatRappen(
  format: ReturnType<typeof useFormatter>,
  rappen: number | string,
): string {
  return format.number(rappenToChf(Number(rappen)), "chf");
}

/** The VAT rate as a percentage string (`8.1%`), from the fraction the order stores. Pure. */
export function formatVatRate(
  format: ReturnType<typeof useFormatter>,
  rate: number | string,
): string {
  return format.number(Number(rate), "percent");
}
