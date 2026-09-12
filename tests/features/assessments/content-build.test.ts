// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  extractJsonBlock,
  extractTitle,
  mapIso,
  mapStandards,
  type RawIso,
  type RawStandards,
  rawIsoSchema,
  rawStandardsSchema,
} from "@/features/assessments/content-build";

/**
 * The pure half of `pnpm questionnaires:build` (spec 0019, AC-1): the JSON block and the title
 * pulled out of a raw export, and the two mappers that turn it into English content in document
 * order, with positions running 1 to N, annex lines nested under their clause, collapsed labels
 * restored within their group and empty requirements as null. The committed files are covered by
 * `content.test.ts`; this covers the mapping rules on small inputs where each rule is visible.
 */
const HTML = `<!doctype html><html><head><title> ISO 45001 Gap Assessment </title></head>
<body><script>window.x = 1;</script>
<script type="application/json">{"sections":[],"annexes":{}}</script></body></html>`;

describe("extractJsonBlock and extractTitle", () => {
  it("parses the application/json block and trims the title", () => {
    expect(extractJsonBlock(HTML)).toEqual({ sections: [], annexes: {} });
    expect(extractTitle(HTML)).toBe("ISO 45001 Gap Assessment");
  });

  it("throws a plain message when the block or the title is missing, so a wrong file is noticed", () => {
    expect(() => extractJsonBlock("<html><script>1</script></html>")).toThrow(
      /no <script type="application\/json"> block/,
    );
    expect(() => extractTitle("<html><title>   </title></html>")).toThrow(/no <title>/);
  });
});

describe("mapIso", () => {
  const raw: RawIso = rawIsoSchema.parse({
    sections: [
      {
        code: 8,
        name: "Operation",
        clauses: [
          {
            clause: "8.1",
            title: "Operational planning",
            requirement: "",
            question: "Is operation planned?",
            annex: "A",
          },
          {
            clause: "8.1",
            title: "Hierarchy of controls",
            requirement: "- Eliminate\n- Substitute",
            question: "Is the hierarchy applied?",
            annex: null,
          },
          {
            clause: "8.2",
            title: "Emergency preparedness",
            requirement: "A plan exists.",
            question: "Is there a plan?",
            annex: null,
          },
        ],
      },
    ],
    annexes: {
      A: {
        clauseRef: "8.1",
        title: "Annex A",
        intro: "",
        items: [
          { row: 1, text: "Contractors are briefed", rateable: true },
          { row: 2, text: "Context only", rateable: false },
        ],
      },
    },
  });

  it("keys the section by its code, restores the collapsed clause label and numbers positions in document order", () => {
    const content = mapIso(raw, "ISO 45001 Gap Assessment");
    expect(content.key).toBe("iso45001");
    expect(content.title).toBe("ISO 45001 Gap Assessment");
    expect(content.sections).toEqual([{ key: "c8", label: "8", title: "Operation", groups: [] }]);
    expect(content.items.map((item) => [item.position, item.label, item.parentPosition])).toEqual([
      [1, "8.1", null],
      [2, "A.1", 1],
      [3, "A.2", 1],
      [4, "8.10", null],
      [5, "8.2", null],
    ]);
  });

  it("nests the annex lines under their clause with one text as title and question, the context line not rateable", () => {
    const [, first, second] = mapIso(raw, "t").items;
    expect(first).toEqual({
      position: 2,
      label: "A.1",
      sectionKey: "c8",
      groupKey: null,
      parentPosition: 1,
      rateable: true,
      en: {
        title: "Contractors are briefed",
        requirement: null,
        question: "Contractors are briefed",
      },
    });
    expect(second?.rateable).toBe(false);
  });

  it("turns an empty requirement into null while keeping a real one", () => {
    const items = mapIso(raw, "t").items;
    expect(items[0]?.en).toEqual({
      title: "Operational planning",
      requirement: null,
      question: "Is operation planned?",
    });
    expect(items[3]?.en.requirement).toBe("- Eliminate\n- Substitute");
    expect(items[4]?.en.requirement).toBe("A plan exists.");
  });

  it("throws when a clause names an annex the export does not carry", () => {
    const broken: RawIso = { ...raw, annexes: {} };
    expect(() => mapIso(broken, "t")).toThrow(/clause 8.1 names annex A, which is missing/);
  });
});

describe("mapStandards", () => {
  const raw: RawStandards = rawStandardsSchema.parse({
    standards: [
      {
        key: "ladders",
        name: "Ladders and steps",
        sections: [
          {
            code: 1,
            name: "General",
            clauses: [
              {
                item: "1.1",
                title: "Inspected",
                requirement: "",
                question: "Inspected yearly?",
                rateable: true,
              },
              {
                item: "1.1",
                title: "Tagged",
                requirement: "Each ladder tagged.",
                question: "Tagged?",
                rateable: true,
              },
            ],
          },
          {
            code: 2,
            name: "Use",
            clauses: [
              {
                item: "2.1",
                title: "Three points",
                requirement: "",
                question: "Three points of contact?",
                rateable: true,
              },
              {
                item: "2.2",
                title: "Note",
                requirement: "",
                question: "Context only",
                rateable: false,
              },
            ],
          },
        ],
      },
      {
        key: "scaffolds",
        name: "Scaffolds",
        sections: [
          {
            code: 1,
            name: "General",
            clauses: [
              {
                item: "1.1",
                title: "Erected by trained staff",
                requirement: "",
                question: "Trained?",
                rateable: true,
              },
            ],
          },
        ],
      },
    ],
  });

  it("numbers the standards by their place, keys each group under its standard and restores labels within the group", () => {
    const content = mapStandards(raw, "Compliance Assessment");
    expect(content.key).toBe("compliance");
    expect(content.sections.map((section) => [section.key, section.label, section.title])).toEqual([
      ["ladders", "1", "Ladders and steps"],
      ["scaffolds", "2", "Scaffolds"],
    ]);
    expect(content.sections[0]?.groups).toEqual([
      { key: "ladders.1", label: "1", title: "General" },
      { key: "ladders.2", label: "2", title: "Use" },
    ]);
    expect(
      content.items.map((item) => [item.position, item.sectionKey, item.groupKey, item.label]),
    ).toEqual([
      [1, "ladders", "ladders.1", "1.1"],
      [2, "ladders", "ladders.1", "1.10"],
      [3, "ladders", "ladders.2", "2.1"],
      [4, "ladders", "ladders.2", "2.2"],
      [5, "scaffolds", "scaffolds.1", "1.1"],
    ]);
  });

  it("keeps every requirement a top level item, carries the rateable flag and nulls an empty requirement", () => {
    const items = mapStandards(raw, "t").items;
    expect(items.every((item) => item.parentPosition === null)).toBe(true);
    expect(items.map((item) => item.rateable)).toEqual([true, true, true, false, true]);
    expect(items[0]?.en.requirement).toBeNull();
    expect(items[1]?.en.requirement).toBe("Each ladder tagged.");
  });

  it("refuses a standard key that is not a snake case identifier", () => {
    expect(
      rawStandardsSchema.safeParse({
        standards: [{ key: "Hot-Work", name: "x", sections: [] }],
      }).success,
    ).toBe(false);
  });
});
