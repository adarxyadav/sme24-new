import type { ReactElement } from "react";
import type { z } from "zod";
import {
  assignmentReceivedDataSchema,
  benchmarkReadyDataSchema,
  type EmailTemplateName,
  enquiryReceivedDataSchema,
  expertAssignedDataSchema,
  expertWelcomeDataSchema,
  orderConfirmedDataSchema,
  welcomeDataSchema,
} from "./schema";
import { AssignmentReceivedEmail } from "./templates/assignment-received";
import { BenchmarkReadyEmail } from "./templates/benchmark-ready";
import { EnquiryReceivedEmail } from "./templates/enquiry-received";
import { ExpertAssignedEmail } from "./templates/expert-assigned";
import { ExpertWelcomeEmail } from "./templates/expert-welcome";
import { OrderConfirmedEmail } from "./templates/order-confirmed";
import type { TemplateProps } from "./templates/props";
import { WelcomeEmail } from "./templates/welcome";

/** The bare app path without a locale prefix (`/app`); the renderer prefixes it. */
export type EmailLink = `/${string}`;

/** One template: its data schema, the app path its button and notification point at, and whether a known recipient gets a notification row. */
export type EmailTemplateEntry<TData> = {
  readonly schema: z.ZodType<TData>;
  /**
   * The path the button and the notification row point at: a constant for most templates, a
   * function of the already validated data when the target is one row (spec 0013, AC-14).
   */
  readonly link: EmailLink | ((data: TData) => EmailLink);
  /** False for emails that are not worth a feed entry; `ops.*` source events never notify anyway. */
  readonly notify: boolean;
  readonly Component: (props: TemplateProps<TData>) => ReactElement;
};

/**
 * The template registry (spec 0006, AC-4, AC-14): one entry per email SME24 sends. Each entry's
 * subject and preview live at `email.<name>.subject` and `email.<name>.preview`. A later feature
 * adds a template by adding its data schema in `schema.ts`, its component in `templates/` and one
 * entry here; nothing else changes. Pure data with component references; tasks, server code and
 * the preview server read it.
 */
export const EMAIL_TEMPLATES = {
  welcome: defineTemplate({
    schema: welcomeDataSchema,
    link: "/app",
    notify: true,
    Component: WelcomeEmail,
  }),
  benchmark_ready: defineTemplate({
    schema: benchmarkReadyDataSchema,
    link: "/app",
    notify: true,
    Component: BenchmarkReadyEmail,
  }),
  // The recipient is an outside address (null `recipient_id`), which already suppresses the
  // notification in send-email; `notify: false` says so for the reader (spec 0009, AC-14).
  enquiry_received: defineTemplate({
    schema: enquiryReceivedDataSchema,
    link: "/",
    notify: false,
    Component: EnquiryReceivedEmail,
  }),
  // The button points at the order list rather than one order, because the template renders
  // without knowing the id; the body carries the reference the buyer quotes (spec 0011, AC-9).
  order_confirmed: defineTemplate({
    schema: orderConfirmedDataSchema,
    link: "/app/orders",
    notify: true,
    Component: OrderConfirmedEmail,
  }),
  expert_welcome: defineTemplate({
    schema: expertWelcomeDataSchema,
    link: "/expert/profile",
    notify: true,
    Component: ExpertWelcomeEmail,
  }),
  // The one link that depends on its data: the expert is sent to the client they were just given,
  // not to the list, and the notification row carries the same path (spec 0013, AC-14).
  assignment_received: defineTemplate({
    schema: assignmentReceivedDataSchema,
    link: (data) => `/expert/clients/${data.organizationId}`,
    notify: true,
    Component: AssignmentReceivedEmail,
  }),
  expert_assigned: defineTemplate({
    schema: expertAssignedDataSchema,
    link: "/app",
    notify: true,
    Component: ExpertAssignedEmail,
  }),
} as const satisfies Record<EmailTemplateName, unknown>;

/**
 * The path one entry points at for the given data: the constant, or the function applied to the
 * data the entry's own schema has already validated. Pure; the renderer and the send-email task.
 */
export function templateLink<TData>(entry: EmailTemplateEntry<TData>, data: TData): EmailLink {
  return typeof entry.link === "function" ? entry.link(data) : entry.link;
}

/** Keeps the data schema and the component of one entry on the same type. */
function defineTemplate<TData>(entry: EmailTemplateEntry<TData>): EmailTemplateEntry<TData> {
  return entry;
}

/**
 * The entry of one template widened to unknown data, for the renderer: it validates the data
 * through the entry's own schema before handing it to the component, so the widening is safe.
 */
export function templateEntry(
  name: EmailTemplateName,
): EmailTemplateEntry<Record<string, unknown>> {
  return EMAIL_TEMPLATES[name] as unknown as EmailTemplateEntry<Record<string, unknown>>;
}

/** True when `name` is a registered template (the ops preview reads the name from a stored row). */
export function isEmailTemplateName(name: string): name is EmailTemplateName {
  return Object.hasOwn(EMAIL_TEMPLATES, name);
}
