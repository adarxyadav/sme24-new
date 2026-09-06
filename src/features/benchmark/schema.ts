import { z } from "zod";
import { NOGA_DIVISIONS } from "./catalogue";

/**
 * The benchmark feature's boundary schemas (spec 0008, AC-11): the company facts form. The same
 * schema types the form. Pure, runs anywhere.
 */

/** The largest headcount the form accepts (AC-11). */
export const MAX_EMPLOYEES = 1_000_000;

// The browser resolver transforms the values before the server action parses them again, so the
// fields accept their own output as input: an empty division or headcount becomes `undefined`.
const industryCodeField = z
  .string()
  .trim()
  .nullish()
  .transform((value, context) => {
    if (!value) return undefined;
    if (!NOGA_DIVISIONS.includes(value)) {
      context.addIssue({ code: "custom", message: "industryInvalid" });
      return z.NEVER;
    }
    return value;
  });

const employeesField = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value, context) => {
    if (value === null || value === undefined || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(String(value).trim());
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_EMPLOYEES) {
      context.addIssue({ code: "custom", message: "employeesInvalid" });
      return z.NEVER;
    }
    return parsed;
  });

/** The facts form (AC-11): the NOGA division, the headcount, at least one of the two, plus the company id. */
export const companyFactsFormSchema = z
  .object({
    companyId: z.uuid(),
    industryCode: industryCodeField,
    employeesCount: employeesField,
    locale: z.string().optional(),
  })
  .refine((values) => values.industryCode !== undefined || values.employeesCount !== undefined, {
    message: "nothingToSave",
    path: ["employeesCount"],
  });
export type CompanyFactsInput = z.input<typeof companyFactsFormSchema>;
export type CompanyFactsValues = z.output<typeof companyFactsFormSchema>;

/** The two digit division of a stored NOGA code (`23.61` gives `23`), or an empty string. Pure. */
export function divisionOf(code: string | null): string {
  const match = code?.trim().match(/^(\d{2})(?:\.\d{2})?$/);
  return match?.[1] ?? "";
}
