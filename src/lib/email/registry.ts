import type { ReactElement } from "react";
import type { z } from "zod";
import { benchmarkReadyDataSchema, type EmailTemplateName, welcomeDataSchema } from "./schema";
import { BenchmarkReadyEmail } from "./templates/benchmark-ready";
import type { TemplateProps } from "./templates/props";
import { WelcomeEmail } from "./templates/welcome";

/** One template: its data schema, the app path its button and notification point at, and whether a known recipient gets a notification row. */
export type EmailTemplateEntry<TData> = {
  readonly schema: z.ZodType<TData>;
  /** The bare app path without a locale prefix (`/app`); the renderer prefixes it. */
  readonly link: `/${string}`;
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
} as const satisfies Record<EmailTemplateName, unknown>;

/** Keeps the data schema and the component of one entry on the same type. */
function defineTemplate<TData>(entry: EmailTemplateEntry<TData>): EmailTemplateEntry<TData> {
  return entry;
}

/** True when `name` is a registered template (the ops preview reads the name from a stored row). */
export function isEmailTemplateName(name: string): name is EmailTemplateName {
  return Object.hasOwn(EMAIL_TEMPLATES, name);
}
