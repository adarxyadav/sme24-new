import { z } from "zod";
import {
  AVAILABILITY_CODES,
  COMPETENCY_CODES,
  EXPERT_STATUSES,
  INDUSTRY_CODES,
  LANGUAGE_CODES,
  REGION_CODES,
  STANDARD_CODES,
} from "./catalogue";

/**
 * The boundary schemas of the expert feature (spec 0013). Every action parses its input with one
 * of these and the profile form is typed from `expertProfileSchema`, so the browser and the server
 * agree on the rules and the database check constraints are the third net rather than the first.
 * Message strings are keys of `experts.form.errors`, resolved by `issueMessage`. Pure, runs anywhere.
 */

/** The select value that means every status, on the ops list filter. */
export const ALL_STATUSES = "all";

/** The `/admin/experts` query parameters: the status filter (every status by default) and the cursor. */
export const expertFiltersSchema = z.object({
  status: z.enum([...EXPERT_STATUSES, ALL_STATUSES]).catch(ALL_STATUSES),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type ExpertFilters = z.infer<typeof expertFiltersSchema>;

/** The invite form on `/admin/experts/new`. The role is never here: the action hard codes it. */
export const inviteExpertSchema = z.object({
  email: z.email("emailInvalid").trim().toLowerCase().max(320, "emailLong"),
  fullName: z.string().trim().min(1, "fullNameRequired").max(200, "fullNameLong"),
  locale: z.enum(["de", "en"]),
});
export type InviteExpertInput = z.input<typeof inviteExpertSchema>;
export type InviteExpertValues = z.output<typeof inviteExpertSchema>;

/** Every action that names one expert. */
export const expertIdSchema = z.object({ expertId: z.uuid() });

/** The ops notes editor on the expert's admin page. Empty is allowed: clearing a note is normal. */
export const opsNotesSchema = z.object({
  expertId: z.uuid(),
  notes: z.string().trim().max(4000, "notesLong").default(""),
});
export type OpsNotesInput = z.input<typeof opsNotesSchema>;
export type OpsNotesValues = z.output<typeof opsNotesSchema>;

/** The assign form: an expert and the organization ops picked from the combobox. */
export const assignExpertSchema = z.object({
  expertId: z.uuid(),
  organizationId: z.uuid("organizationRequired"),
});
export type AssignExpertInput = z.input<typeof assignExpertSchema>;

/** Ending one assignment from the ops page. */
export const endAssignmentSchema = z.object({ assignmentId: z.uuid() });

/** A phone number as people actually write one in Switzerland; the shape is not validated further. */
const PHONE_PATTERN = /^[+0-9 ()/-]*$/;

/** An empty string from a form field means "not set", which is null in the database, not "". */
const emptyToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

/**
 * The onboarding form (AC-4): consent plus the few fields that make an expert findable at all.
 * Deliberately shorter than the full profile: the rest can wait, this cannot, because an expert
 * with no language and no region cannot be matched or assigned sensibly.
 */
export const onboardingSchema = z.object({
  termsAccepted: z.literal(true, "termsRequired"),
  fullName: z.string().trim().min(1, "fullNameRequired").max(200, "fullNameLong"),
  headline: z.string().trim().min(1, "headlineRequired").max(120, "headlineLong"),
  languages: z.array(z.enum(LANGUAGE_CODES)).min(1, "languagesRequired"),
  regions: z.array(z.enum(REGION_CODES)).min(1, "regionsRequired"),
  locale: z.string().optional(),
});
export type OnboardingInput = z.input<typeof onboardingSchema>;
export type OnboardingValues = z.output<typeof onboardingSchema>;

/**
 * The full profile form (AC-5), for the expert on `/expert/profile` and for ops on the expert's
 * admin page. `expertId` is optional and only an ops caller may send one; the action refuses a
 * non ops caller who does, rather than quietly writing their own row.
 *
 * A factory rather than a constant because `available_from` is checked against today, and "today"
 * is the server clock in Europe/Zurich (the same rule as spec 0010's `currentYear`): a module
 * level schema would freeze the date at import time and start rejecting valid dates the next day.
 */
export function expertProfileSchema(today: string) {
  return z.object({
    expertId: z.uuid().optional(),
    headline: z.string().trim().min(1, "headlineRequired").max(120, "headlineLong"),
    bio: z
      .string()
      .trim()
      .max(800, "bioLong")
      .transform((value) => (value === "" ? null : value))
      .nullable(),
    competencies: z.array(z.enum(COMPETENCY_CODES)).min(1, "competenciesRequired"),
    industries: z.array(z.enum(INDUSTRY_CODES)),
    standards: z.array(z.enum(STANDARD_CODES)),
    languages: z.array(z.enum(LANGUAGE_CODES)).min(1, "languagesRequired"),
    regions: z.array(z.enum(REGION_CODES)).min(1, "regionsRequired"),
    availability: z.enum(AVAILABILITY_CODES),
    availableFrom: z.preprocess(
      emptyToNull,
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "availableFromInvalid")
        .refine((value) => value >= today, "availableFromPast")
        .nullable(),
    ),
    availabilityNote: z.preprocess(
      emptyToNull,
      z.string().trim().max(300, "availabilityNoteLong").nullable(),
    ),
    yearsExperience: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? null : value),
      z.coerce
        .number("yearsExperienceInvalid")
        .int("yearsExperienceInvalid")
        .min(0, "yearsExperienceRange")
        .max(60, "yearsExperienceRange")
        .nullable(),
    ),
    phone: z.preprocess(
      emptyToNull,
      z.string().trim().max(30, "phoneLong").regex(PHONE_PATTERN, "phoneInvalid").nullable(),
    ),
    locale: z.string().optional(),
  });
}

export type ExpertProfileInput = z.input<ReturnType<typeof expertProfileSchema>>;
export type ExpertProfileValues = z.output<ReturnType<typeof expertProfileSchema>>;

/**
 * Today in Europe/Zurich as `YYYY-MM-DD`, the reference date `available_from` is checked against.
 * Swiss time rather than UTC: an expert setting a date late in the evening should not be told the
 * date is in the past because the server has already rolled over. Pure, runs anywhere.
 */
export function todayInZurich(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Builds the query string of the ops list from the filter plus a cursor, dropping the defaults. Pure. */
export function expertListQuery(
  filters: Omit<ExpertFilters, "cursor">,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.status !== ALL_STATUSES) params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}
