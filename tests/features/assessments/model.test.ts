// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  type AssessmentAnswer,
  type AssessmentItem,
  computeProgress,
  computeScore,
  gapList,
  type SectionOutline,
  suggestedRating,
} from "@/features/assessments/model";

/**
 * The pure scoring model (spec 0019, AC-7, AC-9): the running score, the progress the submit
 * dialog reads, the annex suggestion and the gap list. What matters here is the arithmetic that
 * the locked score and feature 18's report both depend on: sub items never count, an excluded
 * section is neither counted nor required, nothing rated is `null` rather than 0, and a percent
 * is a whole number.
 */

const text = (en: string) => ({ de: `${en} (de)`, en });

const SECTIONS: readonly SectionOutline[] = [
  { key: "c4", label: "4", title: text("Context") },
  { key: "c6", label: "6", title: text("Planning") },
  { key: "c7", label: "7", title: text("Support") },
];

function item(
  position: number,
  label: string,
  sectionKey: string,
  overrides: Partial<AssessmentItem> = {},
): AssessmentItem {
  return {
    id: `iso45001@1/${position}`,
    position,
    parentId: null,
    sectionKey,
    groupKey: null,
    label,
    rateable: true,
    title: text(`Item ${label}`),
    requirement: null,
    question: text(`Question ${label}`),
    deReviewed: false,
    ...overrides,
  };
}

/** Three clauses in 4, one clause in 6 with three annex lines (two rateable), one clause in 7. */
const ITEMS: readonly AssessmentItem[] = [
  item(1, "4.1", "c4"),
  item(2, "4.2", "c4"),
  item(3, "4.3", "c4"),
  item(4, "6.1", "c6"),
  item(5, "A.1", "c6", { parentId: "iso45001@1/4" }),
  item(6, "A.2", "c6", { parentId: "iso45001@1/4" }),
  item(7, "A.3", "c6", { parentId: "iso45001@1/4", rateable: false }),
  item(8, "7.1", "c7"),
];

function rating(
  position: number,
  value: AssessmentAnswer["rating"],
  note: string | null = null,
): AssessmentAnswer {
  return { itemId: `iso45001@1/${position}`, sectionKey: null, rating: value, note };
}

function exclusion(sectionKey: string, note: string | null = null): AssessmentAnswer {
  return { itemId: null, sectionKey, rating: null, note };
}

describe("computeScore (AC-9)", () => {
  it("answers null percentages and zero counts when nothing is rated", () => {
    const score = computeScore(SECTIONS, ITEMS, []);
    expect(score.overall).toBeNull();
    expect(score.rated).toBe(0);
    expect(score.total).toBe(5);
    expect(score.sections.map((section) => section.percent)).toEqual([null, null, null]);
    expect(score.sections.map((section) => section.total)).toEqual([3, 1, 1]);
  });

  it("averages the rating values of the rated top level items into a whole percent", () => {
    const score = computeScore(SECTIONS, ITEMS, [
      rating(1, "compliant"),
      rating(2, "partial"),
      rating(3, "partial"),
    ]);
    // (1 + 0.5 + 0.5) / 3 = 0.6667, rounded to 67, never 66.67 and never truncated to 66.
    expect(score.overall).toBe(67);
    expect(score.rated).toBe(3);
    expect(score.sections[0]).toMatchObject({ key: "c4", percent: 67, rated: 3, total: 3 });
    expect(score.sections[1]).toMatchObject({ key: "c6", percent: null, rated: 0, total: 1 });
  });

  it("rounds half up on the boundary and reaches 0 and 100", () => {
    expect(
      computeScore(SECTIONS, ITEMS, [rating(1, "non_compliant"), rating(2, "non_compliant")])
        .overall,
    ).toBe(0);
    expect(computeScore(SECTIONS, ITEMS, [rating(1, "compliant")]).overall).toBe(100);
    // 1 + 0.5 + 0.5 + 0.5 + 0.5 + 0 + 0 + 0 = 3 / 8 = 37.5 -> 38.
    expect(
      computeScore(
        SECTIONS,
        [...ITEMS, item(9, "7.2", "c7"), item(10, "7.3", "c7"), item(11, "7.4", "c7")],
        [
          rating(1, "compliant"),
          rating(2, "partial"),
          rating(3, "partial"),
          rating(4, "partial"),
          rating(8, "partial"),
          rating(9, "non_compliant"),
          rating(10, "non_compliant"),
          rating(11, "non_compliant"),
        ],
      ).overall,
    ).toBe(38);
  });

  it("never counts a sub item, whatever it is rated (AC-7)", () => {
    const withSubItemsOnly = computeScore(SECTIONS, ITEMS, [
      rating(5, "non_compliant"),
      rating(6, "non_compliant"),
    ]);
    expect(withSubItemsOnly.overall).toBeNull();
    expect(withSubItemsOnly.rated).toBe(0);

    const withClause = computeScore(SECTIONS, ITEMS, [
      rating(4, "compliant"),
      rating(5, "non_compliant"),
      rating(6, "non_compliant"),
    ]);
    expect(withClause.overall).toBe(100);
    expect(withClause.sections[1]).toMatchObject({ percent: 100, rated: 1, total: 1 });
  });

  it("ignores a note without a rating and an unknown item", () => {
    const score = computeScore(SECTIONS, ITEMS, [
      rating(1, null, "looked, not judged yet"),
      { itemId: "iso45001@1/999", sectionKey: null, rating: "compliant", note: null },
    ]);
    expect(score.overall).toBeNull();
    expect(score.rated).toBe(0);
  });

  it("skips an excluded section and lists it with its note", () => {
    const score = computeScore(SECTIONS, ITEMS, [
      exclusion("c4", "No such activity on this site"),
      rating(1, "non_compliant"),
      rating(4, "compliant"),
    ]);
    // The non compliant 4.1 sits in the excluded section, so it neither drags the score down nor
    // counts as rated; the total drops to the two remaining sections.
    expect(score.overall).toBe(100);
    expect(score.rated).toBe(1);
    expect(score.total).toBe(2);
    expect(score.excludedSections).toEqual(["c4"]);
    expect(score.sections[0]).toMatchObject({
      key: "c4",
      excluded: true,
      exclusionNote: "No such activity on this site",
      percent: null,
      rated: 0,
      total: 3,
    });
  });

  it("keeps the sections in outline order, one row per outline section", () => {
    const score = computeScore(SECTIONS, ITEMS, []);
    expect(score.sections.map((section) => section.key)).toEqual(["c4", "c6", "c7"]);
    expect(score.sections[0]?.title).toEqual(text("Context"));
    expect(score.sections[0]?.label).toBe("4");
  });
});

describe("computeProgress (AC-6, AC-9)", () => {
  it("counts rated top level items over required ones, per section", () => {
    const progress = computeProgress(SECTIONS, ITEMS, [
      rating(1, "compliant"),
      rating(5, "compliant"),
    ]);
    expect(progress).toMatchObject({ rated: 1, required: 5, unrated: 4 });
    expect(
      progress.sections.map((section) => [section.key, section.rated, section.unrated]),
    ).toEqual([
      ["c4", 1, 2],
      ["c6", 0, 1],
      ["c7", 0, 1],
    ]);
  });

  it("drops an excluded section from the required count and marks it", () => {
    const progress = computeProgress(SECTIONS, ITEMS, [exclusion("c4"), rating(4, "partial")]);
    expect(progress).toMatchObject({ rated: 1, required: 2, unrated: 1 });
    expect(progress.sections[0]).toMatchObject({
      key: "c4",
      excluded: true,
      required: 0,
      unrated: 0,
    });
  });

  it("treats a note without a rating as unrated", () => {
    const progress = computeProgress(SECTIONS, ITEMS, [rating(1, null, "note only")]);
    expect(progress.rated).toBe(0);
    expect(progress.unrated).toBe(5);
  });

  it("reports complete when every required item is rated", () => {
    const progress = computeProgress(SECTIONS, ITEMS, [
      rating(1, "compliant"),
      rating(2, "compliant"),
      rating(3, "compliant"),
      rating(4, "non_compliant"),
      rating(8, "partial"),
    ]);
    expect(progress.unrated).toBe(0);
    expect(progress.sections.every((section) => section.unrated === 0)).toBe(true);
  });
});

describe("suggestedRating (AC-7)", () => {
  const clause = "iso45001@1/4";

  it("suggests nothing while no rateable sub item is rated", () => {
    expect(suggestedRating(clause, ITEMS, [])).toBeNull();
    // The clause's own rating and a note on a sub item are not sub item ratings.
    expect(
      suggestedRating(clause, ITEMS, [rating(4, "compliant"), rating(5, null, "seen")]),
    ).toBeNull();
  });

  it("suggests compliant when every rated sub item is compliant, with the rated count", () => {
    expect(suggestedRating(clause, ITEMS, [rating(5, "compliant")])).toEqual({
      rating: "compliant",
      rated: 1,
      total: 2,
    });
    expect(
      suggestedRating(clause, ITEMS, [rating(5, "compliant"), rating(6, "compliant")]),
    ).toEqual({ rating: "compliant", rated: 2, total: 2 });
  });

  it("suggests non compliant when every rated sub item is non compliant", () => {
    expect(
      suggestedRating(clause, ITEMS, [rating(5, "non_compliant"), rating(6, "non_compliant")]),
    ).toEqual({ rating: "non_compliant", rated: 2, total: 2 });
  });

  it("suggests partial for any mix, and for a partial sub item alone", () => {
    expect(
      suggestedRating(clause, ITEMS, [rating(5, "compliant"), rating(6, "non_compliant")]),
    ).toEqual({ rating: "partial", rated: 2, total: 2 });
    expect(suggestedRating(clause, ITEMS, [rating(6, "partial")])).toEqual({
      rating: "partial",
      rated: 1,
      total: 2,
    });
  });

  it("never reads a context line, and answers null for an item without sub items", () => {
    // A.3 is not rateable; a stray rating on it must not become a suggestion.
    expect(suggestedRating(clause, ITEMS, [rating(7, "compliant")])).toBeNull();
    expect(suggestedRating("iso45001@1/1", ITEMS, [rating(1, "compliant")])).toBeNull();
  });
});

describe("gapList (AC-9)", () => {
  it("lists non compliant items first, then partial, each in position order", () => {
    const gaps = gapList(SECTIONS, ITEMS, [
      rating(1, "partial", "Scope not written down"),
      rating(2, "compliant"),
      rating(3, "non_compliant"),
      rating(4, "partial"),
      rating(8, "non_compliant", "No competence records"),
    ]);
    expect(gaps.map((gap) => [gap.label, gap.rating])).toEqual([
      ["4.3", "non_compliant"],
      ["7.1", "non_compliant"],
      ["4.1", "partial"],
      ["6.1", "partial"],
    ]);
    expect(gaps[0]).toMatchObject({
      itemId: "iso45001@1/3",
      title: text("Item 4.3"),
      sectionKey: "c4",
      sectionLabel: "4",
      sectionTitle: text("Context"),
      note: null,
    });
    expect(gaps[1]?.note).toBe("No competence records");
  });

  it("leaves out compliant items, sub items and excluded sections", () => {
    const gaps = gapList(SECTIONS, ITEMS, [
      exclusion("c7"),
      rating(1, "compliant"),
      rating(5, "non_compliant"),
      rating(6, "partial"),
      rating(8, "non_compliant"),
    ]);
    expect(gaps).toEqual([]);
  });

  it("is empty when nothing is rated", () => {
    expect(gapList(SECTIONS, ITEMS, [])).toEqual([]);
  });
});
