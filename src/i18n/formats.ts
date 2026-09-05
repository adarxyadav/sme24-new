import type { Formats } from "next-intl";

/** Every date and time renders in Swiss local time, in the app and in anything a task sends. */
export const TIME_ZONE = "Europe/Zurich";

/**
 * The named formats (spec 0004, AC-3). Usage: `format.number(amount, "chf")`,
 * `format.dateTime(date, "dateShort")`, and inside messages `{amount, number, chf}`.
 * `chf` is for prices, invoice lines and VAT; `chfWhole` for benchmark and incident cost estimates
 * so a modelled figure never looks exact. Percentages come from a fraction (0.123), never from a
 * pre multiplied number. Every date format uses explicit parts rather than a `dateStyle`, because
 * `dateStyle: "short"` gives a two digit year in `de-CH` and the other styles abbreviate or change
 * between ICU versions; explicit parts give the same strings on Node 22 (Vercel) and Node 25 (local).
 */
export const formats = {
  dateTime: {
    dateShort: { day: "2-digit", month: "2-digit", year: "numeric" },
    dateLong: { day: "numeric", month: "long", year: "numeric" },
    dateTime: {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
  },
  number: {
    chf: { style: "currency", currency: "CHF" },
    chfWhole: { style: "currency", currency: "CHF", maximumFractionDigits: 0 },
    percent: { style: "percent", maximumFractionDigits: 1 },
    integer: { maximumFractionDigits: 0 },
  },
} as const satisfies Formats;
