import { z } from "zod";

/**
 * The email rail's boundary schemas (spec 0006, AC-4). Pure data: the task validates its payload
 * with `sendEmailPayloadSchema`, then the template's own data schema from the registry; the ops
 * actions and `sendEmail` build payloads typed by these.
 */

/** The template names the registry knows. A new template adds its name here and its entry in `registry.ts`. */
export const EMAIL_TEMPLATE_NAMES = ["welcome", "benchmark_ready", "enquiry_received"] as const;
export type EmailTemplateName = (typeof EMAIL_TEMPLATE_NAMES)[number];

/** The short language codes the database stores (`profiles.locale`, `email_deliveries.locale`). */
export const emailLocaleSchema = z.enum(["de", "en"]);

/** Every template may greet by first name; the task fills it from the recipient's profile. */
export const templateDataBaseSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(),
});

/** `welcome`: the organization that was just created. */
export const welcomeDataSchema = templateDataBaseSchema.extend({
  organizationName: z.string().trim().min(1).max(200),
});
export type WelcomeData = z.infer<typeof welcomeDataSchema>;

/** `benchmark_ready` (spec 0008, AC-7): the company's first snapshot; the money is already rounded, absent when no cost was computed. */
export const benchmarkReadyDataSchema = templateDataBaseSchema.extend({
  companyName: z.string().trim().min(1).max(200),
  kpisCompared: z.number().int().min(0).max(8),
  costChf: z.number().nonnegative().optional(),
  savingMedianChf: z.number().nonnegative().optional(),
});
export type BenchmarkReadyData = z.infer<typeof benchmarkReadyDataSchema>;
/**
 * `enquiry_received` (spec 0009, AC-14): the acknowledgement of a contact form submission,
 * sent to the outside address the visitor typed. The topic picks the sentence that names what
 * was asked for; the reply time is a constant of the body.
 */
export const enquiryReceivedDataSchema = templateDataBaseSchema.extend({
  contactName: z.string().trim().min(1).max(200),
  topic: z.enum(["retainer", "general"]),
});
export type EnquiryReceivedData = z.infer<typeof enquiryReceivedDataSchema>;

/** A known user (address and language resolved by the task) or a raw address with its language. */
export const emailRecipientSchema = z.union([
  z.object({ userId: z.uuid() }),
  z.object({ email: z.email(), locale: emailLocaleSchema }),
]);
export type EmailRecipient = z.infer<typeof emailRecipientSchema>;

/** A new send: the caller names the template, the data, the recipient and its own idempotency key. */
export const newSendPayloadSchema = z.object({
  kind: z.literal("new"),
  template: z.enum(EMAIL_TEMPLATE_NAMES),
  data: z.record(z.string(), z.unknown()),
  recipient: emailRecipientSchema,
  sourceEvent: z.string().min(1).max(100),
  organizationId: z.uuid().optional(),
  idempotencyKey: z.string().min(1).max(200),
});
export type NewSendPayload = z.infer<typeof newSendPayloadSchema>;

/** An ops retry of a failed row: everything comes from the stored delivery. */
export const retrySendPayloadSchema = z.object({
  kind: z.literal("retry"),
  deliveryId: z.uuid(),
});

/** The `send-email` task payload. */
export const sendEmailPayloadSchema = z.discriminatedUnion("kind", [
  newSendPayloadSchema,
  retrySendPayloadSchema,
]);
export type SendEmailPayload = z.infer<typeof sendEmailPayloadSchema>;

/** The delivery statuses, in the order the ops filter lists them. */
export const DELIVERY_STATUSES = [
  "queued",
  "sending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "skipped",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The source event of the two ops test buttons; `ops.*` events never write a notification. */
export const OPS_TEST_EMAIL_EVENT = "ops.test_email";

/** The source event of the welcome email and the sign up alert. */
export const ORGANIZATION_CREATED_EVENT = "auth.organization_created";

/** The source event of the benchmark ready email (spec 0008, AC-7). */
export const BENCHMARK_SNAPSHOT_CREATED_EVENT = "benchmark.snapshot_created";
/** The source event of the enquiry acknowledgement, the same string as the alert kind so ops can correlate the two (spec 0009, AC-9). */
export const ENQUIRY_RECEIVED_EVENT = "enquiry.received";
