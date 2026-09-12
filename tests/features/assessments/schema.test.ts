// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  ITEM_ID_PATTERN,
  saveAnswerSchema,
  setSectionExclusionSchema,
  startAssessmentSchema,
  submitAssessmentSchema,
  updateAssessmentDetailsSchema,
  zurichCalendarDate,
} from "@/features/assessments/schema";

/**
 * The action boundary (spec 0019): the shapes the five actions accept, the trims and the nulls,
 * and the limits that mirror the column checks so the database never sees what it would refuse.
 */

const ASSESSMENT_ID = "0e000000-0000-4000-8000-000000000001";
const ORG_ID = "0e000000-0000-4000-8000-000000000002";
const COMPANY_ID = "0e000000-0000-4000-8000-000000000003";

describe("startAssessmentSchema", () => {
  it("accepts a catalogue questionnaire key and two uuids", () => {
    const parsed = startAssessmentSchema.safeParse({
      organizationId: ORG_ID,
      companyId: COMPANY_ID,
      questionnaireKey: "iso45001",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses an unknown questionnaire and a malformed id", () => {
    expect(
      startAssessmentSchema.safeParse({
        organizationId: ORG_ID,
        companyId: COMPANY_ID,
        questionnaireKey: "culture",
      }).success,
    ).toBe(false);
    expect(
      startAssessmentSchema.safeParse({
        organizationId: "nope",
        companyId: COMPANY_ID,
        questionnaireKey: "iso45001",
      }).success,
    ).toBe(false);
  });
});

describe("updateAssessmentDetailsSchema", () => {
  it("trims the site and turns an empty one into null", () => {
    const parsed = updateAssessmentDetailsSchema.parse({
      assessmentId: ASSESSMENT_ID,
      site: "  Werk Nord  ",
      conductedOn: "2026-10-03",
    });
    expect(parsed).toEqual({
      assessmentId: ASSESSMENT_ID,
      site: "Werk Nord",
      conductedOn: "2026-10-03",
    });
    expect(
      updateAssessmentDetailsSchema.parse({ assessmentId: ASSESSMENT_ID, site: "   " }),
    ).toEqual({ assessmentId: ASSESSMENT_ID, site: null, conductedOn: null });
  });

  it("caps the site at the column's 200 characters", () => {
    expect(
      updateAssessmentDetailsSchema.safeParse({
        assessmentId: ASSESSMENT_ID,
        site: "x".repeat(201),
      }).success,
    ).toBe(false);
  });

  it("accepts only a calendar date, and a real one", () => {
    for (const bad of ["03.10.2026", "2026-10-03T09:00", "2026-13-01", "yesterday"]) {
      expect(
        updateAssessmentDetailsSchema.safeParse({ assessmentId: ASSESSMENT_ID, conductedOn: bad })
          .success,
        bad,
      ).toBe(false);
    }
    expect(
      updateAssessmentDetailsSchema.safeParse({ assessmentId: ASSESSMENT_ID, conductedOn: null })
        .success,
    ).toBe(true);
  });
});

describe("saveAnswerSchema", () => {
  it("accepts a rating, a null rating and a trimmed note", () => {
    expect(
      saveAnswerSchema.parse({
        assessmentId: ASSESSMENT_ID,
        itemId: "iso45001@1/12",
        rating: "partial",
        note: " Records seen, not signed. ",
      }),
    ).toEqual({
      assessmentId: ASSESSMENT_ID,
      itemId: "iso45001@1/12",
      rating: "partial",
      note: "Records seen, not signed.",
    });
    expect(
      saveAnswerSchema.parse({
        assessmentId: ASSESSMENT_ID,
        itemId: "compliance@1/327",
        rating: null,
        note: "",
      }),
    ).toEqual({
      assessmentId: ASSESSMENT_ID,
      itemId: "compliance@1/327",
      rating: null,
      note: null,
    });
  });

  it("refuses a rating outside the three codes, an item id in the wrong shape and a note over 4000", () => {
    expect(
      saveAnswerSchema.safeParse({
        assessmentId: ASSESSMENT_ID,
        itemId: "iso45001@1/12",
        rating: "yes",
        note: null,
      }).success,
    ).toBe(false);
    for (const bad of ["12", "iso45001/12", "iso45001@1", "ISO45001@1/12"]) {
      expect(ITEM_ID_PATTERN.test(bad), bad).toBe(false);
    }
    expect(
      saveAnswerSchema.safeParse({
        assessmentId: ASSESSMENT_ID,
        itemId: "iso45001@1/12",
        rating: null,
        note: "x".repeat(4001),
      }).success,
    ).toBe(false);
  });
});

describe("setSectionExclusionSchema and submitAssessmentSchema", () => {
  it("accept their shapes", () => {
    expect(
      setSectionExclusionSchema.parse({
        assessmentId: ASSESSMENT_ID,
        sectionKey: "hot_work",
        excluded: true,
        note: null,
      }),
    ).toEqual({ assessmentId: ASSESSMENT_ID, sectionKey: "hot_work", excluded: true, note: null });
    expect(submitAssessmentSchema.safeParse({ assessmentId: ASSESSMENT_ID }).success).toBe(true);
    expect(submitAssessmentSchema.safeParse({ assessmentId: 12 }).success).toBe(false);
  });
});

describe("zurichCalendarDate (AC-5)", () => {
  it("names the Swiss calendar day of an instant, not the UTC one", () => {
    // 23:30 UTC on the 2nd is 01:30 on the 3rd in Zurich (summer, UTC+2).
    expect(zurichCalendarDate(new Date("2026-07-02T23:30:00Z"))).toBe("2026-07-03");
    // 23:30 UTC on the 2nd is 00:30 on the 3rd in Zurich (winter, UTC+1).
    expect(zurichCalendarDate(new Date("2026-12-02T23:30:00Z"))).toBe("2026-12-03");
    expect(zurichCalendarDate(new Date("2026-12-02T12:00:00Z"))).toBe("2026-12-02");
  });
});
