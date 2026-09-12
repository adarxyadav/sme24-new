/**
 * The questionnaire catalogue (spec 0019, AC-1, AC-2): which questionnaires exist, what each one
 * allows, the three way rating scale and which package visit runs which checklist. Content
 * (sections, items, texts) lives in `content/<key>.json` and reaches the database through
 * `pnpm questionnaires:migration`; this file holds only what the code needs. A Vitest test keeps
 * `QUESTIONNAIRE_KEYS` equal to the content files on disk. Alias free and dependency free on
 * purpose, so the hand run scripts import it by relative `.ts` path. Pure data, runs anywhere.
 */
export const QUESTIONNAIRE_KEYS = ["iso45001", "compliance"] as const;
export type QuestionnaireKey = (typeof QUESTIONNAIRE_KEYS)[number];

export type QuestionnaireDefinition = {
  readonly key: QuestionnaireKey;
  /**
   * Whether an expert may mark a whole section not applicable (AC-8). True for the technical
   * standards, where a site simply may have no excavation or no hot work; false for ISO 45001,
   * where every clause applies to every management system.
   */
  readonly allowsSectionExclusion: boolean;
};

export const QUESTIONNAIRES: { readonly [K in QuestionnaireKey]: QuestionnaireDefinition } = {
  iso45001: { key: "iso45001", allowsSectionExclusion: false },
  compliance: { key: "compliance", allowsSectionExclusion: true },
};

/** The three ratings an expert gives an item, as stored in `assessment_answers.rating`. */
export const RATING_CODES = ["compliant", "partial", "non_compliant"] as const;
export type RatingCode = (typeof RATING_CODES)[number];

/** The value of each rating in the score (AC-9); read only by `model.ts`. */
export const RATING_VALUES: { readonly [R in RatingCode]: number } = {
  compliant: 1,
  partial: 0.5,
  non_compliant: 0,
};

/**
 * Which questionnaires a package's visit runs (AC-5), the ladder of `PACKAGES` in spec 0009 read
 * as checklists: the culture package and the retainer run none of the two built here (the Safety
 * Culture content is a Follow-up), the management system package runs ISO 45001, and the
 * compliance package runs both.
 */
export const PACKAGE_QUESTIONNAIRES: {
  readonly [packageKey: string]: readonly QuestionnaireKey[];
} = {
  culture: [],
  sms: ["iso45001"],
  compliance: ["compliance", "iso45001"],
  retainer: [],
};
