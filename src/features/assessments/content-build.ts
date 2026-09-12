import { z } from "zod";
import type { QuestionnaireKey } from "./catalogue.ts";
import {
  applyTextFixes,
  fixLabel,
  type ItemTexts,
  normalizeText,
  replaceResiduals,
  restoreLabels,
} from "./content-fixes.ts";

/**
 * The pure half of `pnpm questionnaires:build` (spec 0019, AC-1): the shape of the JSON block in
 * each raw HTML export and the mapping from it to English content in document order, with the
 * content fixes applied. The script reads the files and drafts the German; this module never
 * touches the filesystem or the network. Alias free on purpose.
 */

const rawText = z.string();

export const rawIsoSchema = z.object({
  sections: z.array(
    z.object({
      code: z.int(),
      name: rawText.min(1),
      clauses: z.array(
        z.object({
          clause: rawText.min(1),
          title: rawText.min(1),
          requirement: rawText,
          question: rawText.min(1),
          annex: z.string().nullable(),
        }),
      ),
    }),
  ),
  annexes: z.record(
    z.string(),
    z.object({
      clauseRef: rawText.min(1),
      title: rawText,
      intro: rawText,
      items: z.array(z.object({ row: z.int(), text: rawText.min(1), rateable: z.boolean() })),
    }),
  ),
});
export type RawIso = z.infer<typeof rawIsoSchema>;

export const rawStandardsSchema = z.object({
  standards: z.array(
    z.object({
      key: z.string().regex(/^[a-z][a-z0-9_]*$/),
      name: rawText.min(1),
      sections: z.array(
        z.object({
          code: z.int(),
          name: rawText.min(1),
          clauses: z.array(
            z.object({
              item: rawText.min(1),
              title: rawText.min(1),
              requirement: rawText,
              question: rawText.min(1),
              rateable: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export type RawStandards = z.infer<typeof rawStandardsSchema>;

/** A content file before the German exists: every text is English only. */
export type EnglishGroup = { readonly key: string; readonly label: string; readonly title: string };
export type EnglishSection = {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly groups: readonly EnglishGroup[];
};
export type EnglishItem = {
  readonly position: number;
  readonly label: string;
  readonly sectionKey: string;
  readonly groupKey: string | null;
  readonly parentPosition: number | null;
  readonly rateable: boolean;
  readonly en: ItemTexts;
};
export type EnglishContent = {
  readonly key: QuestionnaireKey;
  readonly title: string;
  readonly sections: readonly EnglishSection[];
  readonly items: readonly EnglishItem[];
};

/** The JSON block of a raw export: the one `<script type="application/json">` element. Pure. */
export function extractJsonBlock(html: string): unknown {
  const match = html.match(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) throw new Error('no <script type="application/json"> block in the file');
  return JSON.parse(match[1]);
}

/** The document title of a raw export, from its first `<title>`. Pure. */
export function extractTitle(html: string): string {
  const match = html.match(/<title>([^<]*)<\/title>/);
  const title = match?.[1]?.trim();
  if (!title) throw new Error("no <title> in the file");
  return title;
}

/** The three texts of a raw item made uniform, fixed by the override table and freed of residuals. Pure. */
function fixedTexts(
  questionnaire: QuestionnaireKey,
  section: string,
  label: string,
  raw: { readonly title: string; readonly requirement: string; readonly question: string },
): ItemTexts {
  const normalized: ItemTexts = {
    title: normalizeText(raw.title),
    requirement: normalizeText(raw.requirement) === "" ? null : normalizeText(raw.requirement),
    question: normalizeText(raw.question),
  };
  const fixed = applyTextFixes(questionnaire, section, label, normalized);
  return {
    title: replaceResiduals(fixed.title),
    requirement: fixed.requirement === null ? null : replaceResiduals(fixed.requirement),
    question: replaceResiduals(fixed.question),
  };
}

/**
 * ISO 45001 in document order: the seven sections as `c4` to `c10`, each clause a top level
 * rateable item, and the annex items of a clause right after it as its sub items (`A.1`, …),
 * a non rateable annex line being context text. Pure.
 */
export function mapIso(raw: RawIso, title: string): EnglishContent {
  const sections: EnglishSection[] = raw.sections.map((section) => ({
    key: `c${section.code}`,
    label: String(section.code),
    title: replaceResiduals(normalizeText(section.name)),
    groups: [],
  }));
  const items: EnglishItem[] = [];
  raw.sections.forEach((section, sectionIndex) => {
    const sectionKey = sections[sectionIndex]?.key ?? `c${section.code}`;
    const labels = restoreLabels(
      section.clauses.map((clause) => fixLabel("iso45001", sectionKey, clause.clause)),
    );
    section.clauses.forEach((clause, clauseIndex) => {
      const label = labels[clauseIndex] ?? clause.clause;
      const clausePosition = items.length + 1;
      items.push({
        position: clausePosition,
        label,
        sectionKey,
        groupKey: null,
        parentPosition: null,
        rateable: true,
        en: fixedTexts("iso45001", sectionKey, label, clause),
      });
      if (clause.annex === null) return;
      const annex = raw.annexes[clause.annex];
      if (!annex)
        throw new Error(`clause ${clause.clause} names annex ${clause.annex}, which is missing`);
      annex.items.forEach((annexItem, annexIndex) => {
        const annexLabel = `${clause.annex}.${annexIndex + 1}`;
        const text = replaceResiduals(normalizeText(annexItem.text));
        items.push({
          position: items.length + 1,
          label: annexLabel,
          sectionKey,
          groupKey: null,
          parentPosition: clausePosition,
          rateable: annexItem.rateable,
          // An annex line carries one text: it is both what the item is and what is rated.
          en: { title: text, requirement: null, question: text },
        });
      });
    });
  });
  return { key: "iso45001", title, sections, items };
}

/**
 * The technical standards in document order: each standard a section keyed by its own key and
 * numbered by its place, each of its sections a group keyed `<standard>.<code>`, each
 * requirement a top level item with its label restored within the group. Pure.
 */
export function mapStandards(raw: RawStandards, title: string): EnglishContent {
  const sections: EnglishSection[] = raw.standards.map((standard, index) => ({
    key: standard.key,
    label: String(index + 1),
    title: replaceResiduals(normalizeText(standard.name)),
    groups: standard.sections.map((group) => ({
      key: `${standard.key}.${group.code}`,
      label: String(group.code),
      title: replaceResiduals(normalizeText(group.name)),
    })),
  }));
  const items: EnglishItem[] = [];
  for (const standard of raw.standards) {
    for (const group of standard.sections) {
      const groupKey = `${standard.key}.${group.code}`;
      const labels = restoreLabels(
        group.clauses.map((clause) => fixLabel("compliance", standard.key, clause.item)),
      );
      group.clauses.forEach((clause, clauseIndex) => {
        const label = labels[clauseIndex] ?? clause.item;
        items.push({
          position: items.length + 1,
          label,
          sectionKey: standard.key,
          groupKey,
          parentPosition: null,
          rateable: clause.rateable,
          en: fixedTexts("compliance", standard.key, label, clause),
        });
      });
    }
  }
  return { key: "compliance", title, sections, items };
}
