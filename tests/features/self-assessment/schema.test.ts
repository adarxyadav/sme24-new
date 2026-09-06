import { describe, expect, it } from "vitest";
import { KPI_KEYS } from "@/features/research/catalogue";
import { clearClientKpiSchema, clientKpisFormSchema } from "@/features/self-assessment/schema";

/**
 * The form schema (spec 0010, AC-4): a comma decimal is accepted, three decimals, a decimal on an
 * integer KPI, a `2` on the yes or no KPI and an out of range value per KPI are rejected on the
 * field's own path, an empty or blank field is dropped, an all empty form fails with
 * `nothingToSave` on the year, and the year is bounded by 2000 and the current year. Pure.
 */
const COMPANY = "0c000000-0000-4000-8000-00000000000a";
const schema = clientKpisFormSchema(2026);
const form = (values: Record<string, unknown>, periodYear: unknown = 2024) => ({
  companyId: COMPANY,
  periodYear,
  values,
});

function issuesOf(input: unknown) {
  const result = schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => [issue.path, issue.message]);
}

describe("clientKpisFormSchema", () => {
  it("accepts a comma decimal, drops blank fields and normalises yes or no", () => {
    const result = schema.safeParse(
      form({
        ltifr: "2,5",
        trifr: "  ",
        fatalities: "",
        iso_45001_certified: "1",
        near_miss_rate: null,
      }),
    );
    expect(result.success).toBe(true);
    expect(result.success && result.data.values).toEqual({
      ltifr: 2.5,
      iso_45001_certified: 1,
    });
    expect(result.success && result.data.periodYear).toBe(2024);
  });

  it("accepts a number as well as a string", () => {
    const result = schema.safeParse(form({ absenteeism_rate: 4.2, fatalities: 0 }));
    expect(result.success && result.data.values).toEqual({ absenteeism_rate: 4.2, fatalities: 0 });
  });

  it.each([
    ["three decimals", { ltifr: "2.555" }, "ltifr"],
    ["a decimal on an integer KPI", { fatalities: "1.5" }, "fatalities"],
    ["2 on the yes or no KPI", { iso_45001_certified: "2" }, "iso_45001_certified"],
    ["text", { trifr: "many" }, "trifr"],
    ...KPI_KEYS.map((key): [string, Record<string, string>, string] => [
      `${key} out of range`,
      { [key]: "100000" },
      key,
    ]),
    ["a negative value", { ltifr: "-1" }, "ltifr"],
  ])("rejects %s on the field's path", (_name, values, key) => {
    expect(issuesOf(form(values))).toEqual([[["values", key], "valueInvalid"]]);
  });

  it("fails with nothingToSave on the year when every value is empty", () => {
    expect(issuesOf(form({ ltifr: "", trifr: null }))).toEqual([[["periodYear"], "nothingToSave"]]);
    expect(issuesOf(form({}))).toEqual([[["periodYear"], "nothingToSave"]]);
  });

  it("bounds the year by 2000 and the current year and requires an integer", () => {
    expect(issuesOf(form({ ltifr: "1" }, 1999))).toEqual([[["periodYear"], "yearInvalid"]]);
    expect(issuesOf(form({ ltifr: "1" }, 2027))).toEqual([[["periodYear"], "yearInvalid"]]);
    expect(issuesOf(form({ ltifr: "1" }, 2024.5))).toEqual([[["periodYear"], "yearInvalid"]]);
    expect(issuesOf(form({ ltifr: "1" }, "2024"))).toEqual([[["periodYear"], "yearInvalid"]]);
    expect(schema.safeParse(form({ ltifr: "1" }, 2000)).success).toBe(true);
    expect(schema.safeParse(form({ ltifr: "1" }, 2026)).success).toBe(true);
  });

  it("requires a company id", () => {
    const result = schema.safeParse({ periodYear: 2024, values: { ltifr: "1" } });
    expect(result.success).toBe(false);
  });
});

describe("clearClientKpiSchema (AC-6)", () => {
  it("accepts a catalogue key and an integer year, rejects the rest", () => {
    expect(
      clearClientKpiSchema.safeParse({ companyId: COMPANY, kpiKey: "ltifr", periodYear: 2024 })
        .success,
    ).toBe(true);
    expect(
      clearClientKpiSchema.safeParse({ companyId: COMPANY, kpiKey: "other", periodYear: 2024 })
        .success,
    ).toBe(false);
    expect(
      clearClientKpiSchema.safeParse({ companyId: COMPANY, kpiKey: "ltifr", periodYear: 1999 })
        .success,
    ).toBe(false);
  });
});
