import { z } from "zod";

/**
 * The alert rail's boundary schemas (spec 0006, AC-11): one typed `fields` shape per alert kind.
 * Live kinds have a caller today; reserved kinds are typed for the features that will fire them
 * (8, 11, 13). Pure data. A recipient's email address is never a field: Slack gets names and
 * company names only.
 */
export const ALERT_KINDS = [
  "client.signed_up",
  "email.failed",
  "ops.test",
  "research.run_failed",
  "payment.received",
  "enquiry.received",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

const alertFields = {
  /** The task resolves the person's name and language from `userId`; the time is `now()`. */
  "client.signed_up": z.object({
    organizationName: z.string().min(1).max(200),
    userId: z.uuid(),
  }),
  "email.failed": z.object({
    deliveryId: z.uuid(),
    template: z.string().min(1).max(100),
    reason: z.string().min(1).max(500),
  }),
  "ops.test": z.object({
    triggeredBy: z.string().min(1).max(200),
  }),
  "research.run_failed": z.object({
    runId: z.string().min(1).max(100),
    organizationName: z.string().min(1).max(200),
    reason: z.string().min(1).max(500),
  }),
  "payment.received": z.object({
    organizationName: z.string().min(1).max(200),
    amountChf: z.number().nonnegative(),
    reference: z.string().min(1).max(100),
  }),
  "enquiry.received": z.object({
    organizationName: z.string().min(1).max(200),
    topic: z.string().min(1).max(200),
  }),
} as const satisfies Record<AlertKind, z.ZodType>;

/** The typed fields of one kind. */
export type AlertFields<K extends AlertKind> = z.infer<(typeof alertFields)[K]>;

const entry = <K extends AlertKind>(kind: K) =>
  z.object({
    kind: z.literal(kind),
    fields: alertFields[kind],
    /** A bare app path (`/admin/emails/<id>`); the builder prefixes the app URL and `/de`. */
    link: z.string().regex(/^\//).max(500).optional(),
    idempotencyKey: z.string().min(1).max(200),
  });

/** The `ops-alert` task payload: kind, its typed fields, an optional link and the caller's key. */
export const opsAlertPayloadSchema = z.discriminatedUnion("kind", [
  entry("client.signed_up"),
  entry("email.failed"),
  entry("ops.test"),
  entry("research.run_failed"),
  entry("payment.received"),
  entry("enquiry.received"),
]);
export type OpsAlertPayload = z.infer<typeof opsAlertPayloadSchema>;
