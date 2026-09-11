import { z } from "zod";

/**
 * The alert rail's boundary schemas (spec 0006, AC-11): one typed `fields` shape per alert kind.
 * Live kinds have a caller today; reserved kinds are typed for the features that will fire them
 * (11, 13); spec 0008 adds `benchmark.failed`. Pure data. A recipient's email address is never a field: Slack gets names and
 * company names only.
 */
export const ALERT_KINDS = [
  "client.signed_up",
  "email.failed",
  "ops.test",
  "research.run_failed",
  "benchmark.failed",
  "payment.received",
  "enquiry.received",
  "invoice.render_failed",
  "expert.onboarded",
  "data_request.received",
  "task.failed",
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
  "benchmark.failed": z.object({
    organizationName: z.string().min(1).max(200),
    companyName: z.string().min(1).max(200),
    triggerKind: z.enum(["research", "client_edit", "recompute"]),
    errorMessage: z.string().min(1).max(500),
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
  /**
   * Spec 0011 (AC-10): the invoice PDF exhausted its retries. The order stays paid and the client
   * keeps their purchase; ops retry the render from the admin. The invoice number is the handle
   * ops work with, so it is the field, not the internal id alone.
   */
  "invoice.render_failed": z.object({
    invoiceNumber: z.string().min(1).max(50),
    reference: z.string().min(1).max(100),
    organizationName: z.string().min(1).max(200),
    errorMessage: z.string().min(1).max(500),
  }),
  /**
   * Spec 0013 (AC-14): an invited expert finished onboarding and is now assignable. Ops read it to
   * start the record check, so the address is the field they need to reach the person. One of the
   * two alerts carrying an email address, and this one is a colleague's rather than a client's;
   * `data_request.received` is the other.
   */
  "expert.onboarded": z.object({
    expertName: z.string().min(1).max(200),
    email: z.email().max(200),
    competencies: z.string().max(300),
  }),
  /**
   * Spec 0015 (AC-13): someone exercised a data subject right and the thirty day answer window
   * has started. This alert carries the subject's email on purpose, and it is the second to do so
   * after `expert.onboarded`: ops answer a data request by contacting the person, and an alert
   * that named only an id would send them back to the admin to find the address anyway. The due
   * date is a formatted Swiss date, so the deadline is legible in the channel itself.
   */
  "data_request.received": z.object({
    kind: z.enum(["export", "deletion"]),
    email: z.email().max(320),
    dueOn: z.string().min(1).max(40),
  }),
  /**
   * Spec 0017 (AC-9): a background task exhausted its retries. Raised from the global
   * `tasks.onFailure` hook, so it covers every task including ones not yet written. `attempts` is
   * the attempt number the run died on, which is the retry budget for that task. `error` is capped
   * like every other reason field, so a stack trace never reaches Slack: the trace is in Sentry,
   * and the run page behind the button is where it is reproduced.
   */
  "task.failed": z.object({
    taskId: z.string().min(1).max(200),
    runId: z.string().min(1).max(100),
    attempts: z.number().int().positive(),
    error: z.string().min(1).max(500),
  }),
} as const satisfies Record<AlertKind, z.ZodType>;

/** The typed fields of one kind. */
export type AlertFields<K extends AlertKind> = z.infer<(typeof alertFields)[K]>;

const entry = <K extends AlertKind>(kind: K) =>
  z.object({
    kind: z.literal(kind),
    fields: alertFields[kind],
    /** A bare app path (`/admin/emails/<id>`); the builder prefixes the app URL and the locale. */
    link: z.string().regex(/^\//).max(500).optional(),
    /** An absolute https link outside the app (spec 0007: the Trigger.dev run page); `link` wins when both are set. */
    externalUrl: z
      .url({ protocol: /^https$/ })
      .max(500)
      .optional(),
    idempotencyKey: z.string().min(1).max(200),
  });

/** The `ops-alert` task payload: kind, its typed fields, an optional link and the caller's key. */
export const opsAlertPayloadSchema = z.discriminatedUnion("kind", [
  entry("client.signed_up"),
  entry("email.failed"),
  entry("ops.test"),
  entry("research.run_failed"),
  entry("benchmark.failed"),
  entry("payment.received"),
  entry("enquiry.received"),
  entry("invoice.render_failed"),
  entry("expert.onboarded"),
  entry("data_request.received"),
  entry("task.failed"),
]);
export type OpsAlertPayload = z.infer<typeof opsAlertPayloadSchema>;
