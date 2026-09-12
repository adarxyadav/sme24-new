import { z } from "zod";
import { QUESTIONNAIRE_KEYS } from "./catalogue.ts";

/**
 * The shape of a committed content file, `src/features/assessments/content/<key>.json` (spec
 * 0019, AC-1): one questionnaire version with its outline (sections and groups) and its items in
 * document order. `pnpm questionnaires:build` writes it, `pnpm questionnaires:migration` reads it,
 * and a Vitest test parses the committed files with it. Every text is a `{de, en}` pair; a German
 * text the build script drafted carries `deReviewed: false` until a person clears it. Alias free
 * (`zod` only), so the scripts can import it by relative `.ts` path. Pure.
 */

/** A text in both product languages; never empty in either. */
export const localizedTextSchema = z.object({
  de: z.string().min(1),
  en: z.string().min(1),
});
export type LocalizedText = z.infer<typeof localizedTextSchema>;

const keySchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)?$/);

export const contentGroupSchema = z.object({
  /** `<section key>.<code>`, for example `electrical_safety.2`. */
  key: keySchema,
  /** The display number of the group within its section, for example `2`. */
  label: z.string().min(1),
  title: localizedTextSchema,
});
export type ContentGroup = z.infer<typeof contentGroupSchema>;

export const contentSectionSchema = z.object({
  /** `c4` to `c10` for ISO 45001, the standard key for the technical standards. */
  key: keySchema,
  /** The display number of the section, for example `4` or `12`. */
  label: z.string().min(1),
  title: localizedTextSchema,
  /** Empty for ISO 45001; the standard's groups for the technical standards. */
  groups: z.array(contentGroupSchema),
});
export type ContentSection = z.infer<typeof contentSectionSchema>;

export const contentItemSchema = z.object({
  /** 1 to N in document order; the identity of the item, never its label (invariant 6). */
  position: z.int().min(1),
  /** The display number: `4.1`, `1.10`, `A.3`. */
  label: z.string().min(1),
  sectionKey: keySchema,
  groupKey: keySchema.nullable(),
  /** The position of the clause an annex sub item belongs to; null for a top level item. */
  parentPosition: z.int().min(1).nullable(),
  rateable: z.boolean(),
  title: localizedTextSchema,
  requirement: localizedTextSchema.nullable(),
  question: localizedTextSchema,
  /** False while the German is the build script's draft; a reviewer sets it true by hand. */
  deReviewed: z.boolean(),
});
export type ContentItem = z.infer<typeof contentItemSchema>;

export const contentFileSchema = z
  .object({
    key: z.enum(QUESTIONNAIRE_KEYS),
    version: z.int().min(1),
    title: localizedTextSchema,
    /** Which raw file and export the content came from; stored on the version row. */
    sourceNote: z.string().min(1).nullable(),
    sections: z.array(contentSectionSchema).min(1),
    items: z.array(contentItemSchema).min(1),
  })
  .superRefine((file, ctx) => {
    file.items.forEach((item, index) => {
      if (item.position !== index + 1) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "position"],
          message: `positions must run 1 to N in file order; item ${index + 1} has position ${item.position}`,
        });
      }
      if (item.parentPosition !== null && item.parentPosition >= item.position) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "parentPosition"],
          message: "a parent must precede its children",
        });
      }
      const section = file.sections.find((candidate) => candidate.key === item.sectionKey);
      if (!section) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "sectionKey"],
          message: `unknown section ${item.sectionKey}`,
        });
      } else if (
        item.groupKey !== null &&
        !section.groups.some((group) => group.key === item.groupKey)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["items", index, "groupKey"],
          message: `unknown group ${item.groupKey} in section ${item.sectionKey}`,
        });
      }
    });
  });
export type ContentFile = z.infer<typeof contentFileSchema>;

/** The version key a content file seeds, `<questionnaire key>@<version>` (AC-2). Pure. */
export function versionKeyOf(file: Pick<ContentFile, "key" | "version">): string {
  return `${file.key}@${file.version}`;
}

/** The id of one item, `<version key>/<position>` (AC-2). Pure. */
export function itemIdOf(versionKey: string, position: number): string {
  return `${versionKey}/${position}`;
}
