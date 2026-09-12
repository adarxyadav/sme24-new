import { describe, expect, it } from "vitest";
import {
  applyTextFixes,
  ContentFixError,
  fixLabel,
  LABEL_FIXES,
  normalizeText,
  replaceResiduals,
  restoreLabels,
  TEXT_FIXES,
} from "@/features/assessments/content-fixes";

/** The pure content fixes (spec 0019, AC-1). */

describe("restoreLabels", () => {
  it("appends a zero to a label already seen in the group, keeping the first occurrence", () => {
    expect(restoreLabels(["1.1", "1.2", "1.3", "1.1", "1.2"])).toEqual([
      "1.1",
      "1.2",
      "1.3",
      "1.10",
      "1.20",
    ]);
  });

  it("appends another zero should the restored label collide again", () => {
    expect(restoreLabels(["1.1", "1.1", "1.10", "1.1"])).toEqual([
      "1.1",
      "1.10",
      "1.100",
      "1.1000",
    ]);
  });

  it("leaves unique labels alone and handles an empty group", () => {
    expect(restoreLabels(["4.1", "4.2"])).toEqual(["4.1", "4.2"]);
    expect(restoreLabels([])).toEqual([]);
  });
});

describe("fixLabel", () => {
  it("drops the trailing dot of ISO 7.5. and nothing else", () => {
    expect(LABEL_FIXES).toHaveLength(1);
    expect(fixLabel("iso45001", "c7", "7.5.")).toBe("7.5");
    expect(fixLabel("iso45001", "c7", "7.4")).toBe("7.4");
    expect(fixLabel("compliance", "c7", "7.5.")).toBe("7.5.");
  });
});

describe("applyTextFixes", () => {
  const texts = { title: "Alpha", requirement: null, question: "Is it quality?" };

  it("returns the texts unchanged when no fix names the item", () => {
    expect(applyTextFixes("compliance", "ppe", "1.1", texts)).toEqual(texts);
  });

  it("replaces the fragment of a listed item and sets a whole field", () => {
    const fixed = applyTextFixes("iso45001", "c10", "10.1", {
      title: "Improvement",
      requirement: null,
      question: "How? Do they enhance customer satisfaction?",
    });
    expect(fixed.question).toBe("How? Do they improve OH&S performance?");
    const set = applyTextFixes("compliance", "electrical_safety", "3.3", {
      title: "GFCI",
      requirement: null,
      question: "Program to check GFCIs",
    });
    expect(set.requirement).toMatch(
      /^A program is in place to check ground fault circuit interrupters/,
    );
    expect(set.question).toMatch(/^Is there a program to check ground fault circuit interrupters/);
  });

  it("throws a ContentFixError when a replace fragment is absent, so a stale rule is noticed", () => {
    expect(() =>
      applyTextFixes("iso45001", "c10", "10.1", {
        title: "x",
        requirement: null,
        question: "already fixed",
      }),
    ).toThrow(ContentFixError);
    expect(() =>
      applyTextFixes("iso45001", "c5", "5.2", {
        title: "x",
        requirement: null,
        question: "continually improving quality? Is it available to customers?",
      }),
    ).toThrow(/OHO&S/);
  });

  it("keys every rule by a known questionnaire, section and label, and every rule is used at most once per field order", () => {
    for (const fix of TEXT_FIXES) {
      expect(["iso45001", "compliance"]).toContain(fix.questionnaire);
      expect(fix.section).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(fix.label).toMatch(/^\d+(\.\d+)*$/);
      expect(["title", "requirement", "question"]).toContain(fix.field);
      if ("replace" in fix) expect(fix.replace).not.toBe(fix.with);
    }
  });
});

describe("replaceResiduals and normalizeText", () => {
  it("replaces every remaining client name with the company", () => {
    expect(replaceResiduals("Lonza staff and Lonza sites")).toBe(
      "the company staff and the company sites",
    );
    expect(replaceResiduals("nothing here")).toBe("nothing here");
  });

  it("makes whitespace uniform and keeps the bullets", () => {
    expect(normalizeText("Policy that:\r\n•\tone;  \r\n•\ttwo.\n\n")).toBe(
      "Policy that:\n• one;\n• two.",
    );
  });
});
