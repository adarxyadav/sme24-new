import { describe, expect, it } from "vitest";
import type { ContentFile } from "@/features/assessments/content-schema";
import {
  assembleItems,
  checkAnswers,
  chunk,
  itemEntries,
  itemMemoryKey,
  rememberItems,
  rememberTitles,
} from "@/features/assessments/translate";
import {
  questionnaireTranslationPrompt,
  questionnaireTranslationSystemPrompt,
} from "@/lib/ai/prompts/questionnaire-translation";

/** The pure half of the German draft (spec 0019, AC-1): the reuse rule, the batching, the checks. */

const previous: ContentFile = {
  key: "iso45001",
  version: 1,
  title: { de: "Titel", en: "Title" },
  sourceNote: null,
  sections: [
    {
      key: "c4",
      label: "4",
      title: { de: "Kontext", en: "Context" },
      groups: [{ key: "c4.1", label: "1", title: { de: "Gruppe", en: "Group" } }],
    },
  ],
  items: [
    {
      position: 1,
      label: "4.1",
      sectionKey: "c4",
      groupKey: null,
      parentPosition: null,
      rateable: true,
      title: { de: "Titel eins", en: "Title one" },
      requirement: { de: "Anforderung", en: "Requirement" },
      question: { de: "Frage?", en: "Question?" },
      deReviewed: true,
    },
    {
      position: 2,
      label: "A.1",
      sectionKey: "c4",
      groupKey: null,
      parentPosition: 1,
      rateable: false,
      title: { de: "Zeile", en: "Line" },
      requirement: null,
      question: { de: "Zeile", en: "Line" },
      deReviewed: false,
    },
  ],
};

describe("the reuse rule", () => {
  it("remembers an item's German and review flag by its three English texts, byte for byte", () => {
    const memory = rememberItems(previous);
    const reviewed = memory.get(
      itemMemoryKey({ title: "Title one", requirement: "Requirement", question: "Question?" }),
    );
    expect(reviewed).toEqual({
      de: { title: "Titel eins", requirement: "Anforderung", question: "Frage?" },
      deReviewed: true,
    });
    expect(
      memory.get(itemMemoryKey({ title: "Line", requirement: null, question: "Line" }))?.deReviewed,
    ).toBe(false);
    // One changed character in any of the three texts is a new item.
    expect(
      memory.has(
        itemMemoryKey({ title: "Title one", requirement: "Requirement.", question: "Question?" }),
      ),
    ).toBe(false);
    expect(itemMemoryKey({ title: "a", requirement: null, question: "b" })).not.toBe(
      itemMemoryKey({ title: "a", requirement: "null", question: "b" }),
    );
  });

  it("remembers the version, section and group titles by their English", () => {
    const titles = rememberTitles(previous);
    expect(titles.get("Title")).toBe("Titel");
    expect(titles.get("Context")).toBe("Kontext");
    expect(titles.get("Group")).toBe("Gruppe");
    expect(rememberTitles(null).size).toBe(0);
    expect(rememberItems(null).size).toBe(0);
  });
});

describe("the batching", () => {
  it("cuts a list into slices of at most the given size", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(() => chunk([1], 0)).toThrow(RangeError);
  });

  it("builds up to three entries per item and reads them back by position", () => {
    const items = [
      { position: 7, label: "4.1", en: { title: "T", requirement: "R", question: "Q" } },
      { position: 8, label: "A.1", en: { title: "L", requirement: null, question: "L" } },
    ];
    const entries = itemEntries(items);
    expect(entries.map((entry) => entry.id)).toEqual([
      "7:title",
      "7:requirement",
      "7:question",
      "8:title",
      "8:question",
    ]);
    expect(entries[0]).toEqual({ id: "7:title", kind: "title", label: "4.1", en: "T" });
    const answers = new Map([
      ["7:title", "T de"],
      ["7:requirement", "R de"],
      ["7:question", "Q de"],
      ["8:title", "L de"],
      ["8:question", "L de"],
    ]);
    expect(assembleItems(items, answers)).toEqual(
      new Map([
        [7, { title: "T de", requirement: "R de", question: "Q de" }],
        [8, { title: "L de", requirement: null, question: "L de" }],
      ]),
    );
    expect(() => assembleItems(items, new Map([["7:title", "x"]]))).toThrow(
      "no German for 7:requirement",
    );
  });
});

describe("checkAnswers", () => {
  const entries = [
    { id: "1:title", kind: "title", label: "4.1", en: "A" },
    { id: "1:question", kind: "question", label: "4.1", en: "B?" },
  ];

  it("accepts every id exactly once and trims the texts", () => {
    const answers = checkAnswers(entries, [
      { id: "1:title", de: " A de " },
      { id: "1:question", de: "B de?" },
    ]);
    expect(answers.get("1:title")).toBe("A de");
  });

  it("rejects a missing, a doubled and an unknown id", () => {
    expect(() => checkAnswers(entries, [{ id: "1:title", de: "x" }])).toThrow(
      "1:question not answered",
    );
    expect(() =>
      checkAnswers(entries, [
        { id: "1:title", de: "x" },
        { id: "1:title", de: "y" },
        { id: "1:question", de: "z" },
      ]),
    ).toThrow("answered twice");
    expect(() =>
      checkAnswers(entries, [
        { id: "1:title", de: "x" },
        { id: "1:question", de: "z" },
        { id: "9:title", de: "w" },
      ]),
    ).toThrow("unknown ids answered: 9:title");
  });
});

describe("the prompt", () => {
  it("fixes the register, the official clause titles and the glossary", () => {
    const system = questionnaireTranslationSystemPrompt();
    expect(system).toContain("write ss, never ß");
    expect(system).toContain("6.1.2.1: Ermittlung von Gefährdungen");
    expect(system).toContain("Arbeitssicherheit und Gesundheitsschutz");
    expect(system).toContain("never 'Qualitätsmanagementsystem'");
    expect(system).toContain("Return every id you received exactly once");
  });

  it("lists every entry with its id, kind, label and English", () => {
    const prompt = questionnaireTranslationPrompt(
      { questionnaire: "ISO 45001", section: "4 Context" },
      [
        { id: "1:title", kind: "title", label: "4.1", en: "Understanding" },
        { id: "title:0", kind: "title of a section", label: null, en: "Context" },
      ],
    );
    expect(prompt).toContain("Questionnaire: ISO 45001");
    expect(prompt).toContain("Section: 4 Context");
    expect(prompt).toContain('id: 1:title\nkind: title of item 4.1\nen: "Understanding"');
    expect(prompt).toContain('kind: title of a section\nen: "Context"');
  });
});
