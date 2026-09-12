import { RATING_VALUES, type RatingCode } from "./catalogue";
import type { ContentSection, LocalizedText } from "./content-schema";

/**
 * The pure assessment model (spec 0019, AC-7, AC-9): the score, the progress, the annex
 * suggestion and the gap list, all computed from a version's items, the outline and the answer
 * rows. This is the one scoring function in the codebase: the expert's running score, the locked
 * score, the ops alert and feature 18's report all call `computeScore`, so they can never
 * disagree. Nothing here reads the database or the clock. Pure, runs anywhere.
 *
 * The rules (invariant 4): only a rateable item with no parent counts; an annex sub item is rated
 * for the suggestion alone; a non rateable item is context text; an excluded section (an answer
 * row with `item_id` null) is neither counted nor required; a note without a rating is unrated.
 */

/** One `questionnaire_items` row as the queries hand it over, with the jsonb columns typed. */
export type AssessmentItem = {
  readonly id: string;
  readonly position: number;
  /** The clause an annex sub item belongs to; null for a top level item. */
  readonly parentId: string | null;
  readonly sectionKey: string;
  readonly groupKey: string | null;
  readonly label: string;
  readonly rateable: boolean;
  readonly title: LocalizedText;
  readonly requirement: LocalizedText | null;
  readonly question: LocalizedText;
  readonly deReviewed: boolean;
};

/** One `assessment_answers` row: an item answer (`itemId` set) or a section exclusion (`sectionKey` set). */
export type AssessmentAnswer = {
  readonly itemId: string | null;
  readonly sectionKey: string | null;
  readonly rating: RatingCode | null;
  readonly note: string | null;
};

/** What the model needs of the version's outline: the `sections` jsonb without its groups. */
export type SectionOutline = Pick<ContentSection, "key" | "label" | "title">;

export type SectionScore = {
  readonly key: string;
  readonly label: string;
  readonly title: LocalizedText;
  readonly excluded: boolean;
  readonly exclusionNote: string | null;
  /** The whole percent over the rated top level items; null when none is rated or the section is excluded. */
  readonly percent: number | null;
  readonly rated: number;
  /** Rateable top level items of the section, excluded or not. */
  readonly total: number;
};

export type Score = {
  /** The whole percent over every rated top level item of the sections that are not excluded; null when none is rated. */
  readonly overall: number | null;
  readonly rated: number;
  /** Rateable top level items of the sections that are not excluded: what a complete assessment rates. */
  readonly total: number;
  readonly sections: readonly SectionScore[];
  readonly excludedSections: readonly string[];
};

export type SectionProgress = {
  readonly key: string;
  readonly label: string;
  readonly title: LocalizedText;
  readonly excluded: boolean;
  readonly rated: number;
  readonly required: number;
  readonly unrated: number;
};

export type Progress = {
  readonly rated: number;
  readonly required: number;
  readonly unrated: number;
  readonly sections: readonly SectionProgress[];
};

export type Suggestion = {
  readonly rating: RatingCode;
  /** How many rateable sub items carry a rating. */
  readonly rated: number;
  /** How many rateable sub items the clause has. */
  readonly total: number;
};

export type GapEntry = {
  readonly itemId: string;
  readonly label: string;
  readonly title: LocalizedText;
  readonly sectionKey: string;
  readonly sectionLabel: string;
  readonly sectionTitle: LocalizedText;
  readonly rating: Exclude<RatingCode, "compliant">;
  readonly note: string | null;
};

/** True for an item that counts: rateable and without a parent (invariant 4). Pure. */
export function isTopLevelRateable(item: AssessmentItem): boolean {
  return item.rateable && item.parentId === null;
}

/** The excluded sections with their notes, from the rows that carry no item. Pure. */
export function exclusionsOf(
  answers: readonly AssessmentAnswer[],
): ReadonlyMap<string, string | null> {
  return new Map(
    answers
      .filter((answer) => answer.itemId === null && answer.sectionKey !== null)
      .map((answer) => [answer.sectionKey as string, answer.note]),
  );
}

/** The rating per item id, only for the rows that carry one. Pure. */
export function ratingsOf(answers: readonly AssessmentAnswer[]): ReadonlyMap<string, RatingCode> {
  return new Map(
    answers.flatMap((answer) =>
      answer.itemId !== null && answer.rating !== null
        ? [[answer.itemId, answer.rating] as const]
        : [],
    ),
  );
}

/** The note per item id, only for the rows that carry one. Pure. */
export function notesOf(answers: readonly AssessmentAnswer[]): ReadonlyMap<string, string> {
  return new Map(
    answers.flatMap((answer) =>
      answer.itemId !== null && answer.note !== null ? [[answer.itemId, answer.note] as const] : [],
    ),
  );
}

/** The mean rating value of `values` as a whole percent, half up; null for an empty list. Pure. */
function percentOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((100 * sum) / values.length);
}

/**
 * The score (AC-9): per section and overall, the mean rating value of the rated top level items
 * as a whole percent, with an excluded section skipped and listed. Sub items and context lines
 * never count. Null where nothing is rated, so a fresh draft reads "no score yet" rather than 0.
 * Pure.
 */
export function computeScore(
  sections: readonly SectionOutline[],
  items: readonly AssessmentItem[],
  answers: readonly AssessmentAnswer[],
): Score {
  const exclusions = exclusionsOf(answers);
  const ratings = ratingsOf(answers);
  const counted = items.filter(isTopLevelRateable);

  const perSection = sections.map((section): SectionScore => {
    const excluded = exclusions.has(section.key);
    const own = counted.filter((item) => item.sectionKey === section.key);
    const values = excluded
      ? []
      : own.flatMap((item) => {
          const rating = ratings.get(item.id);
          return rating === undefined ? [] : [RATING_VALUES[rating]];
        });
    return {
      key: section.key,
      label: section.label,
      title: section.title,
      excluded,
      exclusionNote: excluded ? (exclusions.get(section.key) ?? null) : null,
      percent: percentOf(values),
      rated: values.length,
      total: own.length,
    };
  });

  const live = counted.filter((item) => !exclusions.has(item.sectionKey));
  const values = live.flatMap((item) => {
    const rating = ratings.get(item.id);
    return rating === undefined ? [] : [RATING_VALUES[rating]];
  });

  return {
    overall: percentOf(values),
    rated: values.length,
    total: live.length,
    sections: perSection,
    excludedSections: perSection
      .filter((section) => section.excluded)
      .map((section) => section.key),
  };
}

/**
 * The progress (AC-6): rated top level items over the required ones, per section and overall,
 * with the unrated count the submit dialog lists and the `incomplete` error names. An excluded
 * section requires nothing. Pure.
 */
export function computeProgress(
  sections: readonly SectionOutline[],
  items: readonly AssessmentItem[],
  answers: readonly AssessmentAnswer[],
): Progress {
  const exclusions = exclusionsOf(answers);
  const ratings = ratingsOf(answers);
  const counted = items.filter(isTopLevelRateable);

  const perSection = sections.map((section): SectionProgress => {
    const excluded = exclusions.has(section.key);
    const own = excluded ? [] : counted.filter((item) => item.sectionKey === section.key);
    const rated = own.filter((item) => ratings.has(item.id)).length;
    return {
      key: section.key,
      label: section.label,
      title: section.title,
      excluded,
      rated,
      required: own.length,
      unrated: own.length - rated,
    };
  });

  const rated = perSection.reduce((total, section) => total + section.rated, 0);
  const required = perSection.reduce((total, section) => total + section.required, 0);
  return { rated, required, unrated: required - rated, sections: perSection };
}

/**
 * The annex suggestion for one clause (AC-7): over the rated rateable sub items of `parentId`,
 * compliant when all are compliant, non compliant when all are non compliant, partial otherwise;
 * null while none is rated or the item has no rateable sub items. Context lines are never read.
 * Pure.
 */
export function suggestedRating(
  parentId: string,
  items: readonly AssessmentItem[],
  answers: readonly AssessmentAnswer[],
): Suggestion | null {
  const ratings = ratingsOf(answers);
  const subItems = items.filter((item) => item.parentId === parentId && item.rateable);
  const rated = subItems.flatMap((item) => {
    const rating = ratings.get(item.id);
    return rating === undefined ? [] : [rating];
  });
  if (rated.length === 0) return null;
  const rating: RatingCode = rated.every((value) => value === "compliant")
    ? "compliant"
    : rated.every((value) => value === "non_compliant")
      ? "non_compliant"
      : "partial";
  return { rating, rated: rated.length, total: subItems.length };
}

const GAP_ORDER: readonly GapEntry["rating"][] = ["non_compliant", "partial"];

/**
 * The gap list (AC-9): every counted item rated non compliant, then every one rated partial, each
 * group in position order, with its label, title, section and note; an excluded section
 * contributes nothing. Pure.
 */
export function gapList(
  sections: readonly SectionOutline[],
  items: readonly AssessmentItem[],
  answers: readonly AssessmentAnswer[],
): readonly GapEntry[] {
  const exclusions = exclusionsOf(answers);
  const ratings = ratingsOf(answers);
  const notes = notesOf(answers);
  const outline = new Map(sections.map((section) => [section.key, section]));
  const counted = [...items]
    .filter((item) => isTopLevelRateable(item) && !exclusions.has(item.sectionKey))
    .sort((a, b) => a.position - b.position);

  return GAP_ORDER.flatMap((wanted) =>
    counted.flatMap((item): GapEntry[] => {
      const rating = ratings.get(item.id);
      const section = outline.get(item.sectionKey);
      if (rating !== wanted || !section) return [];
      return [
        {
          itemId: item.id,
          label: item.label,
          title: item.title,
          sectionKey: section.key,
          sectionLabel: section.label,
          sectionTitle: section.title,
          rating: wanted,
          note: notes.get(item.id) ?? null,
        },
      ];
    }),
  );
}
