import { z } from "zod";
import { QUESTIONNAIRE_KEYS, RATING_CODES } from "./catalogue";

/**
 * The boundary schemas of the five assessment actions (spec 0019): every action parses its input
 * here before it touches the database, and the forms type themselves from the same shapes. The
 * limits mirror the column checks (`site` 1 to 200 characters, `note` at most 4000), so a value
 * the database would refuse is refused with a message first. Pure, runs anywhere.
 */

/** `<questionnaire key>@<version>/<position>`, the id of one `questionnaire_items` row (AC-2). */
export const ITEM_ID_PATTERN = /^[a-z][a-z0-9_]*@[0-9]+\/[0-9]+$/;

/** `YYYY-MM-DD`, the shape a `date` input produces and `conducted_on` stores. */
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A trimmed free text that becomes null when empty, capped at `max` characters. */
const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((value) => value.trim())
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

/** `startAssessment` (AC-5): for which client, which company and which checklist. */
export const startAssessmentSchema = z.object({
  organizationId: z.uuid(),
  companyId: z.uuid(),
  questionnaireKey: z.enum(QUESTIONNAIRE_KEYS),
});
export type StartAssessmentInput = z.output<typeof startAssessmentSchema>;

/** `updateAssessmentDetails` (AC-6): the site and the visit date, the only other editable columns. */
export const updateAssessmentDetailsSchema = z.object({
  assessmentId: z.uuid(),
  site: optionalText(200),
  conductedOn: z
    .string()
    .regex(CALENDAR_DATE_PATTERN, "conductedOnInvalid")
    .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "conductedOnInvalid")
    .nullable()
    .default(null),
});
export type UpdateAssessmentDetailsInput = z.output<typeof updateAssessmentDetailsSchema>;

/** `saveAnswer` (AC-6): one item's rating and note; either may be null while drafting. */
export const saveAnswerSchema = z.object({
  assessmentId: z.uuid(),
  itemId: z.string().regex(ITEM_ID_PATTERN),
  rating: z.enum(RATING_CODES).nullable(),
  note: optionalText(4000),
});
export type SaveAnswerInput = z.output<typeof saveAnswerSchema>;

/** `setSectionExclusion` (AC-8, milestone 4): mark one section not applicable, or applicable again. */
export const setSectionExclusionSchema = z.object({
  assessmentId: z.uuid(),
  sectionKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
  excluded: z.boolean(),
  note: optionalText(4000),
});
export type SetSectionExclusionInput = z.output<typeof setSectionExclusionSchema>;

/** `submitAssessment` (AC-9): which draft to lock. */
export const submitAssessmentSchema = z.object({
  assessmentId: z.uuid(),
});
export type SubmitAssessmentInput = z.output<typeof submitAssessmentSchema>;

/**
 * The calendar date of an instant in Europe/Zurich as `YYYY-MM-DD` (AC-5): a booking scheduled
 * for 00:30 Swiss time on the 3rd is conducted on the 3rd, whatever UTC says. Pure, runs anywhere.
 */
export function zurichCalendarDate(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}
