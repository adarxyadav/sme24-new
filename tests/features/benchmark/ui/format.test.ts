import { createFormatter } from "next-intl";
import { describe, expect, it } from "vitest";
import { formatKpiValue } from "@/features/benchmark/ui/format";
import { formats, TIME_ZONE } from "@/i18n/formats";

/**
 * The KPI value formatter (spec 0008, AC-14): a whole number, two decimals, yes or no, and a
 * percentage built from a fraction, so an `absenteeism_rate` of 3.8 shows as 3.8 % and never as
 * 380 %. The named formats of the app are the ones the components read.
 */
const yesNo = { yes: "Yes", no: "No" };
const en = createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE });
const de = createFormatter({ locale: "de-CH", formats, timeZone: TIME_ZONE });

describe("formatKpiValue (AC-14)", () => {
  it("rounds an integer KPI to a whole number", () => {
    expect(formatKpiValue(0, "integer", en, yesNo)).toBe("0");
    expect(formatKpiValue(2.6, "integer", en, yesNo)).toBe("3");
  });

  it("divides a percent1 value by 100 before the percent format, in both languages", () => {
    expect(formatKpiValue(3.8, "percent1", en, yesNo)).toMatch(/^3\.8\s?%$/);
    expect(formatKpiValue(3.8, "percent1", de, yesNo)).toMatch(/^3[.,]8\s?%$/);
    expect(formatKpiValue(0, "percent1", en, yesNo)).toMatch(/^0\s?%$/);
  });

  it("keeps at most one decimal on a percentage", () => {
    expect(formatKpiValue(3.86, "percent1", en, yesNo)).toMatch(/^3\.9\s?%$/);
  });

  it("reads a yes or no KPI from 1 and 0, with anything at or above 1 as yes", () => {
    expect(formatKpiValue(1, "yesNo", en, yesNo)).toBe("Yes");
    expect(formatKpiValue(0, "yesNo", en, yesNo)).toBe("No");
    expect(formatKpiValue(0.99, "yesNo", en, yesNo)).toBe("No");
    expect(formatKpiValue(2, "yesNo", en, yesNo)).toBe("Yes");
  });

  it("shows exactly two decimals for a decimal KPI, padding and rounding as needed", () => {
    expect(formatKpiValue(2.4, "decimal2", en, yesNo)).toBe("2.40");
    expect(formatKpiValue(68, "decimal2", en, yesNo)).toBe("68.00");
    expect(formatKpiValue(12.456, "decimal2", en, yesNo)).toBe("12.46");
  });
});
