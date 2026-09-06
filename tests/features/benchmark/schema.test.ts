import { describe, expect, it } from "vitest";
import { companyFactsFormSchema, divisionOf, MAX_EMPLOYEES } from "@/features/benchmark/schema";

const COMPANY = "0c000000-0000-4000-8000-00000000000a";

describe("companyFactsFormSchema (spec 0008, AC-11)", () => {
  it("accepts a division, a headcount or both, and normalises empty fields to undefined", () => {
    expect(companyFactsFormSchema.parse({ companyId: COMPANY, industryCode: "23" })).toEqual({
      companyId: COMPANY,
      industryCode: "23",
      employeesCount: undefined,
    });
    expect(
      companyFactsFormSchema.parse({ companyId: COMPANY, industryCode: "", employeesCount: "420" }),
    ).toEqual({ companyId: COMPANY, industryCode: undefined, employeesCount: 420 });
    expect(
      companyFactsFormSchema.parse({ companyId: COMPANY, industryCode: "62", employeesCount: 12 }),
    ).toMatchObject({ industryCode: "62", employeesCount: 12 });
  });

  it("rejects an unknown division, a headcount outside 1 to 1 000 000, and an empty form", () => {
    const issue = (input: Record<string, unknown>) =>
      companyFactsFormSchema.safeParse({ companyId: COMPANY, ...input }).error?.issues[0]?.message;
    expect(issue({ industryCode: "04" })).toBe("industryInvalid");
    expect(issue({ industryCode: "23.61" })).toBe("industryInvalid");
    expect(issue({ employeesCount: 0 })).toBe("employeesInvalid");
    expect(issue({ employeesCount: "1.5" })).toBe("employeesInvalid");
    expect(issue({ employeesCount: MAX_EMPLOYEES + 1 })).toBe("employeesInvalid");
    expect(issue({})).toBe("nothingToSave");
    expect(issue({ industryCode: "", employeesCount: "" })).toBe("nothingToSave");
    expect(
      companyFactsFormSchema.safeParse({ companyId: "nope", industryCode: "23" }).success,
    ).toBe(false);
  });

  it("takes the division of a stored NOGA code for the form default", () => {
    expect(divisionOf("23.61")).toBe("23");
    expect(divisionOf("62")).toBe("62");
    expect(divisionOf(null)).toBe("");
    expect(divisionOf("abc")).toBe("");
  });
});
