import { createFormatterFor } from "@/i18n/standalone";
import type { AlertFields, AlertKind } from "./schema";

/** What one alert says, in English (spec 0006, AC-11): a title, label and value pairs, a button label. */
export type AlertView = {
  readonly title: string;
  readonly fields: ReadonlyArray<readonly [label: string, value: string]>;
  readonly buttonLabel: string;
};

/** What the task resolves before presenting: the person behind a `client.signed_up` and the time. */
export type AlertContext = {
  readonly now: Date;
  readonly person?: { readonly fullName: string; readonly language: string };
};

/** Swiss formats in the English channel (`en-CH`): 05.09.2026, 17:21 and CHF 4'900.00. */
const format = createFormatterFor("en-CH");

type Presenter<K extends AlertKind> = (fields: AlertFields<K>, context: AlertContext) => AlertView;

/**
 * The alert registry (AC-11): one presenter per kind, English only by decision, Swiss formats
 * through the `en-CH` formatter. The three live kinds have callers today; the reserved kinds are
 * ready for features 8, 11 and 13. A new kind adds its fields in `schema.ts` and its presenter
 * here. Pure.
 */
export const ALERT_REGISTRY: { readonly [K in AlertKind]: Presenter<K> } = {
  "client.signed_up": (fields, context) => ({
    title: "New client signed up",
    fields: [
      ["Organization", fields.organizationName],
      ["Name", context.person?.fullName || "Unknown"],
      ["Language", languageName(context.person?.language)],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open admin",
  }),
  "email.failed": (fields, context) => ({
    title: "Email delivery failed",
    fields: [
      ["Template", fields.template],
      ["Reason", fields.reason],
      ["Delivery", fields.deliveryId],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open delivery",
  }),
  "ops.test": (fields, context) => ({
    title: "Test alert",
    fields: [
      ["Triggered by", fields.triggeredBy],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open admin",
  }),
  "research.run_failed": (fields, context) => ({
    title: "Research run failed",
    fields: [
      ["Organization", fields.organizationName],
      ["Run", fields.runId],
      ["Reason", fields.reason],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open run",
  }),
  "benchmark.failed": (fields, context) => ({
    title: "Benchmark computation failed",
    fields: [
      ["Organization", fields.organizationName],
      ["Company", fields.companyName],
      ["Trigger", fields.triggerKind],
      ["Reason", fields.errorMessage],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open run",
  }),
  "payment.received": (fields, context) => ({
    title: "Payment received",
    fields: [
      ["Organization", fields.organizationName],
      ["Amount", format.number(fields.amountChf, "chf")],
      ["Reference", fields.reference],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open payment",
  }),
  "enquiry.received": (fields, context) => ({
    title: "Retainer enquiry received",
    fields: [
      ["Organization", fields.organizationName],
      ["Topic", fields.topic],
      ["Time", format.dateTime(context.now, "dateTime")],
    ],
    buttonLabel: "Open enquiry",
  }),
};

/** Presents one alert through its registry entry. Pure. */
export function presentAlert<K extends AlertKind>(
  kind: K,
  fields: AlertFields<K>,
  context: AlertContext,
): AlertView {
  return ALERT_REGISTRY[kind](fields, context);
}

function languageName(code: string | undefined): string {
  if (code === "de" || code === "de-CH") return "German";
  if (code === "en" || code === "en-CH") return "English";
  return "Unknown";
}
