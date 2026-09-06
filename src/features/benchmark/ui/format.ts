import type { getFormatter } from "next-intl/server";
import type { KpiFormat } from "@/features/research/catalogue";

type Formatter = Awaited<ReturnType<typeof getFormatter>>;

/**
 * A KPI value in the catalogue's display format (spec 0008, AC-14): two decimals, a whole
 * number, yes or no, or a percentage from a fraction, an `absenteeism_rate` value divided by 100
 * first (the `percent1` rule). Pure.
 */
export function formatKpiValue(
  value: number,
  kind: KpiFormat,
  format: Formatter,
  yesNo: { readonly yes: string; readonly no: string },
): string {
  switch (kind) {
    case "integer":
      return format.number(value, "integer");
    case "percent1":
      return format.number(value / 100, "percent");
    case "yesNo":
      return value >= 1 ? yesNo.yes : yesNo.no;
    default:
      return format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
