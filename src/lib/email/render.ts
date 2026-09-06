import { render } from "@react-email/render";
import { createElement, type ReactElement } from "react";
import { localeFromCode } from "@/i18n/routing";
import { createTranslatorFor } from "@/i18n/standalone";
import { EMAIL_TEMPLATES, isEmailTemplateName } from "./registry";
import type { EmailTemplateName } from "./schema";
import type { TemplateProps } from "./templates/props";

export type RenderedEmail = {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
};

export type RenderInput = {
  readonly template: EmailTemplateName;
  /** The short language code stored on the row. */
  readonly locale: "de" | "en";
  /** Already validated against the template's schema by the caller. */
  readonly data: Record<string, unknown>;
  /** `NEXT_PUBLIC_APP_URL`, passed in so this module reads no environment. */
  readonly appUrl: string;
};

/**
 * Renders a registered template in one language (spec 0006, AC-4, AC-14): the subject from
 * `email.<template>.subject`, the HTML and the plain text from the component, the button link
 * from the app URL plus the locale prefix plus the entry's `link`. Throws on invalid data or a
 * missing message key (development and test, spec 0004), which the task maps to `failed`. Runs in
 * the send-email task, the ops preview (server component) and the Vitest render test.
 */
export async function renderEmail(input: RenderInput): Promise<RenderedEmail> {
  const entry = EMAIL_TEMPLATES[input.template];
  const data = entry.schema.parse(input.data);
  const t = await createTranslatorFor(localeFromCode(input.locale));
  const href = `${input.appUrl.replace(/\/$/, "")}/${input.locale}${entry.link}`;
  const subject = t(`email.${input.template}.subject`, messageValues(data));
  // The registry maps each name to its own data type; the entry's schema just parsed `data`, so
  // the component receives what it expects even though the union hides that from TypeScript.
  const Component = entry.Component as (props: TemplateProps<unknown>) => ReactElement;
  const element = createElement(Component, { t, locale: input.locale, data, href });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export type PreviewResult =
  | { readonly ok: true; readonly subject: string; readonly html: string }
  | { readonly ok: false; readonly error: "unknown_template" | "render_failed" };

/**
 * Rerenders a stored delivery for the ops detail page: what the template renders today from the
 * stored `template`, `locale` and `data`, never a byte copy of what was sent. Never throws; an
 * unknown template or a render error becomes an error state on the page. Server component.
 */
export async function renderDeliveryPreview(
  row: { readonly template: string; readonly locale: string; readonly data: unknown },
  appUrl: string,
): Promise<PreviewResult> {
  if (!isEmailTemplateName(row.template)) return { ok: false, error: "unknown_template" };
  const locale = row.locale === "en" ? "en" : "de";
  const data = isRecord(row.data) ? row.data : {};
  try {
    const rendered = await renderEmail({ template: row.template, locale, data, appUrl });
    return { ok: true, subject: rendered.subject, html: rendered.html };
  } catch {
    return { ok: false, error: "render_failed" };
  }
}

/** The ICU values of a subject or preview: every scalar of the template data. */
function messageValues(data: unknown): Record<string, string | number> {
  if (!isRecord(data)) return {};
  return Object.fromEntries(
    Object.entries(data).filter(
      (entry): entry is [string, string | number] =>
        typeof entry[1] === "string" || typeof entry[1] === "number",
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
