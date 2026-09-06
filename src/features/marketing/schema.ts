import { z } from "zod";

/**
 * The enquiry form's boundary schema (spec 0009, AC-8, AC-9): every rule of the contact form,
 * shared by the browser form (through the resolver) and `submitEnquiry`. Custom rules carry keys
 * of `marketing.contact.form.errors`; built in rules (required, invalid email) keep Zod's
 * messages, delivered in the request language (spec 0004). Pure, runs anywhere.
 */

/** The two topics of the one form: the retainer (sold by conversation) or a general question. */
export const ENQUIRY_TOPICS = ["retainer", "general"] as const;
export type EnquiryTopic = (typeof ENQUIRY_TOPICS)[number];

/** The headcount bands of spec 0008. */
export const HEADCOUNT_BANDS = ["1-49", "50-249", "250+"] as const;
export type HeadcountBand = (typeof HEADCOUNT_BANDS)[number];

/** The short language code of the page the form was on (`enquiries.locale`). */
export const enquiryLocaleSchema = z.enum(["de", "en"]);
export type EnquiryLocale = z.infer<typeof enquiryLocaleSchema>;

export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 2000;

/** An optional text field: the browser sends an empty string, the row stores null. */
const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .nullish()
    .transform((value) => (value ? value : null));

export const enquirySchema = z.object({
  topic: z.enum(ENQUIRY_TOPICS),
  companyName: z.string().trim().min(1, "companyRequired").max(200, "companyLong"),
  contactName: z.string().trim().min(1, "nameRequired").max(200, "nameLong"),
  email: z.string().trim().toLowerCase().pipe(z.email()),
  phone: optionalText(40, "phoneLong"),
  headcountBand: z
    .enum(HEADCOUNT_BANDS)
    .or(z.literal(""))
    .nullish()
    .transform((value) => (value ? value : null)),
  message: z.string().trim().min(MESSAGE_MIN, "messageShort").max(MESSAGE_MAX, "messageLong"),
  locale: enquiryLocaleSchema,
});
export type EnquiryInput = z.input<typeof enquirySchema>;
export type EnquiryValues = z.output<typeof enquirySchema>;

/**
 * What the action receives (AC-10): the form values plus the two bot guards, the honeypot
 * `website` (visually hidden; a filled value is a bot) and `startedAt` (the client's mount time
 * in milliseconds; a submission under three seconds later, or with no value, is a bot).
 */
export const enquirySubmissionSchema = enquirySchema.extend({
  website: z.string().max(500).optional(),
  startedAt: z.string().max(20).optional(),
});
export type EnquirySubmission = z.input<typeof enquirySubmissionSchema>;

/**
 * The guard thresholds of `submitEnquiry` (AC-10), here rather than in the action because a
 * `"use server"` module may export only async functions. A submission under `MIN_FILL_MS` after
 * the form mounted is a bot; more than `IP_HOURLY_LIMIT` rows with the same address hash in the
 * last hour, or more than `EMAIL_DAILY_LIMIT` with the same email in the last 24 hours, answer
 * `rate_limited`.
 */
export const MIN_FILL_MS = 3_000;
export const IP_HOURLY_LIMIT = 5;
export const EMAIL_DAILY_LIMIT = 3;

/** The English topic labels the ops channel shows (the alert is English only, spec 0006). */
export const ENQUIRY_TOPIC_LABELS: Record<EnquiryTopic, string> = {
  retainer: "Retainer",
  general: "General question",
};
