import type { QuestionnaireKey } from "./catalogue.ts";

/**
 * The content fixes `pnpm questionnaires:build` applies to Phillip's raw export (spec 0019,
 * AC-1; the override table in rationale.md): the label restoration rule, the label fix, the
 * text overrides keyed by questionnaire, section and label, and the residual replacement of the
 * company name the checklist was written for. Every rule is pure; the build script runs them in
 * the order `fixLabel`, `restoreLabels`, `applyTextFixes`, `replaceResiduals`, and a Vitest test
 * over the committed content files asserts every one of them landed. Alias free on purpose.
 */

export type TextField = "title" | "requirement" | "question";

/** The three texts of one raw item, English, as the export carries them. */
export type ItemTexts = {
  readonly title: string;
  readonly requirement: string | null;
  readonly question: string;
};

/**
 * The Excel origin of the export dropped the trailing zero of `1.10`, `1.20` and `2.10`, so a
 * label repeats within its group. A label already seen in the same group gets a `0` appended
 * (again, should it still collide), which restores the ten affected standards without a table.
 * Pure; the input is the labels of one group (or one section when the section has no groups)
 * in document order.
 */
export function restoreLabels(labels: readonly string[]): string[] {
  const restored: string[] = [];
  for (const label of labels) {
    let candidate = label;
    while (restored.includes(candidate)) candidate = `${candidate}0`;
    restored.push(candidate);
  }
  return restored;
}

export type LabelFix = {
  readonly questionnaire: QuestionnaireKey;
  readonly section: string;
  readonly from: string;
  readonly to: string;
};

/** Raw labels that are typos: ISO `7.5.` carries a trailing dot. */
export const LABEL_FIXES: readonly LabelFix[] = [
  { questionnaire: "iso45001", section: "c7", from: "7.5.", to: "7.5" },
];

/** The corrected label of one raw item, or the raw label when no fix names it. Pure. */
export function fixLabel(questionnaire: QuestionnaireKey, section: string, label: string): string {
  const fix = LABEL_FIXES.find(
    (candidate) =>
      candidate.questionnaire === questionnaire &&
      candidate.section === section &&
      candidate.from === label,
  );
  return fix?.to ?? label;
}

/**
 * One text override. `replace` swaps a fragment that must be present (a stale rule fails the
 * build, so the table is cleaned up when a later export already carries the fix); `set` replaces
 * the whole field, for a text that is wrong from end to end.
 */
export type TextFix = {
  readonly questionnaire: QuestionnaireKey;
  readonly section: string;
  readonly label: string;
  readonly field: TextField;
} & ({ readonly replace: string; readonly with: string } | { readonly set: string });

const ISO_54_REQUIREMENT =
  "Establish, implement and maintain a process for consultation and participation of workers at all levels and functions, and of workers' representatives where they exist, in the development, planning, implementation, performance evaluation and actions for improvement of the OH&S management system; provide the mechanisms, time, training and resources needed; give timely access to clear and relevant information; remove or minimise barriers to participation; emphasise the consultation of non managerial workers on the matters listed in 5.4 d) and their participation in those listed in 5.4 e).";

/** The override table of rationale.md, keyed by questionnaire, section and (restored) label. */
export const TEXT_FIXES: readonly TextFix[] = [
  // ISO 45001: the template was converted from a quality checklist; eight clauses still say so.
  {
    questionnaire: "iso45001",
    section: "c4",
    label: "4.3",
    field: "title",
    replace: "quality management system",
    with: "OH&S management system",
  },
  {
    questionnaire: "iso45001",
    section: "c5",
    label: "5.2",
    field: "question",
    replace: "continually improving quality?",
    with: "continually improving OH&S performance?",
  },
  {
    questionnaire: "iso45001",
    section: "c5",
    label: "5.2",
    field: "question",
    replace: "Is it available to customers?",
    with: "Is it available to interested parties?",
  },
  {
    questionnaire: "iso45001",
    section: "c5",
    label: "5.2",
    field: "requirement",
    replace: "OHO&S",
    with: "OH&S",
  },
  // ISO 5.4 carried the 5.2 policy text; it gets its own requirement.
  {
    questionnaire: "iso45001",
    section: "c5",
    label: "5.4",
    field: "requirement",
    set: ISO_54_REQUIREMENT,
  },
  {
    questionnaire: "iso45001",
    section: "c5",
    label: "5.4",
    field: "question",
    replace: "attendence",
    with: "attendance",
  },
  {
    questionnaire: "iso45001",
    section: "c6",
    label: "6.2.1",
    field: "requirement",
    replace:
      "are relevant to conformity of products and services and the enhancement of customer satisfaction",
    with: "are relevant to the OH&S policy and to the improvement of OH&S performance",
  },
  {
    questionnaire: "iso45001",
    section: "c7",
    label: "7.4",
    field: "question",
    replace:
      "communicaitons with employees, suppliers, customers or other stakeholders about quality and customer satisfaction",
    with: "communications with workers, contractors, visitors and other interested parties about OH&S matters",
  },
  {
    questionnaire: "iso45001",
    section: "c7",
    label: "7.5",
    field: "question",
    replace: "Quality policy, objectives, KPI",
    with: "OH&S policy, objectives, KPI",
  },
  {
    questionnaire: "iso45001",
    section: "c9",
    label: "9.1.1",
    field: "question",
    replace:
      "Are quality objectives, key process indicators or other measures of product quality, service quality, or process quality defined",
    with: "Are OH&S objectives, key process indicators or other measures of OH&S performance defined",
  },
  {
    questionnaire: "iso45001",
    section: "c9",
    label: "9.1.1",
    field: "question",
    replace: "measurements are driving quality performance",
    with: "measurements are driving OH&S performance",
  },
  {
    questionnaire: "iso45001",
    section: "c9",
    label: "9.3",
    field: "question",
    replace: "matters related to quality.",
    with: "matters related to OH&S.",
  },
  {
    questionnaire: "iso45001",
    section: "c9",
    label: "9.3",
    field: "question",
    replace: "can also include quality focus",
    with: "can also include an OH&S focus",
  },
  {
    questionnaire: "iso45001",
    section: "c10",
    label: "10.1",
    field: "question",
    replace: "Do they enhance customer satisfaction?",
    with: "Do they improve OH&S performance?",
  },
  // Technical standards: one Hot Work row still says line breaking.
  {
    questionnaire: "compliance",
    section: "hot_work",
    label: "1.1",
    field: "title",
    replace: "line breaking",
    with: "hot work",
  },
  {
    questionnaire: "compliance",
    section: "hot_work",
    label: "1.1",
    field: "requirement",
    replace: "line breaking",
    with: "hot work",
  },
  {
    questionnaire: "compliance",
    section: "hot_work",
    label: "1.1",
    field: "question",
    replace: "line breaking",
    with: "hot work",
  },
  // Electrical 3.3 has no requirement and a question that is not a question.
  {
    questionnaire: "compliance",
    section: "electrical_safety",
    label: "3.3",
    field: "requirement",
    set: "A program is in place to check ground fault circuit interrupters (GFCI in the USA, DR in Brazil, FI in Switzerland) or the country specific equivalent at the defined interval.",
  },
  {
    questionnaire: "compliance",
    section: "electrical_safety",
    label: "3.3",
    field: "question",
    set: "Is there a program to check ground fault circuit interrupters (or the country specific equivalent) at a defined interval, with records?",
  },
  // Security names the company the checklist was written for.
  {
    questionnaire: "compliance",
    section: "security",
    label: "1.6",
    field: "title",
    replace: "non-Lonza employees (visitors, contractors, truck/railroad personnel)",
    with: "people who are not employees of the company (visitors, contractors, truck and railroad personnel)",
  },
  {
    questionnaire: "compliance",
    section: "security",
    label: "1.6",
    field: "requirement",
    replace: "non-Lonza employees (visitors, contractors, truck/railroad personnel)",
    with: "people who are not employees of the company (visitors, contractors, truck and railroad personnel)",
  },
  {
    questionnaire: "compliance",
    section: "security",
    label: "1.6",
    field: "requirement",
    replace: "escorted by a Lonza employee",
    with: "escorted by an employee of the company",
  },
  {
    questionnaire: "compliance",
    section: "security",
    label: "1.6",
    field: "question",
    replace: "non-Lonza employees",
    with: "people who are not employees of the company",
  },
  {
    questionnaire: "compliance",
    section: "security",
    label: "1.7",
    field: "title",
    replace: "all Lonza employees",
    with: "all employees of the company",
  },
  {
    questionnaire: "compliance",
    section: "security",
    label: "1.7",
    field: "requirement",
    replace: "all Lonza employees",
    with: "all employees of the company",
  },
];

export class ContentFixError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentFixError";
  }
}

/**
 * The texts of one item with every override that names it applied, in table order. Throws a
 * `ContentFixError` when a `replace` fragment is absent, so a stale rule is noticed rather than
 * silently skipped. Pure.
 */
export function applyTextFixes(
  questionnaire: QuestionnaireKey,
  section: string,
  label: string,
  texts: ItemTexts,
): ItemTexts {
  let current = texts;
  for (const fix of TEXT_FIXES) {
    if (fix.questionnaire !== questionnaire || fix.section !== section || fix.label !== label) {
      continue;
    }
    if ("set" in fix) {
      current = { ...current, [fix.field]: fix.set };
      continue;
    }
    const value = current[fix.field];
    if (value === null || !value.includes(fix.replace)) {
      throw new ContentFixError(
        `${questionnaire} ${section} ${label} ${fix.field}: fragment not found: ${JSON.stringify(fix.replace)}`,
      );
    }
    current = { ...current, [fix.field]: value.replace(fix.replace, fix.with) };
  }
  return current;
}

/** Every remaining occurrence of the client name in a later export becomes "the company" (owner decision). */
export const RESIDUAL_REPLACEMENTS: readonly { readonly from: string; readonly to: string }[] = [
  { from: "Lonza", to: "the company" },
];

/** A text with every residual replacement applied. Pure. */
export function replaceResiduals(text: string): string {
  return RESIDUAL_REPLACEMENTS.reduce(
    (current, rule) => current.replaceAll(rule.from, rule.to),
    text,
  );
}

/**
 * The export's whitespace made uniform: Windows line ends become `\n`, a bullet followed by a tab
 * becomes a bullet and a space, trailing whitespace goes from every line and from the ends. The
 * bullets themselves stay, so the page can render a requirement as a list (AC-11). Pure.
 */
export function normalizeText(text: string): string {
  return text
    .replaceAll("\r\n", "\n")
    .replaceAll("•\t", "• ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}
