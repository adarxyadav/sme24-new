import type { createTranslatorFor } from "@/i18n/standalone";

/** The standalone translator every template receives (spec 0004, AC-7). */
export type EmailTranslator = Awaited<ReturnType<typeof createTranslatorFor>>;

/** What the renderer hands a template: the translator, the short locale, validated data and the button link. */
export type TemplateProps<TData> = {
  readonly t: EmailTranslator;
  readonly locale: "de" | "en";
  readonly data: TData;
  /** The absolute button link: app URL plus locale prefix plus the registry entry's `link`. */
  readonly href: string;
};
