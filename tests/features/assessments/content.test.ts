import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_KEYS, QUESTIONNAIRES } from "@/features/assessments/catalogue";
import { type ContentFile, contentFileSchema } from "@/features/assessments/content-schema";

/**
 * The committed content files (spec 0019, AC-1, AC-2): they parse with the content schema, hold
 * the inventory rationale.md states, carry every fix of content-fixes.ts, and match the
 * catalogue keys on disk.
 */

const CONTENT_DIR = join(process.cwd(), "src/features/assessments/content");

function readContent(key: string): ContentFile {
  return contentFileSchema.parse(
    JSON.parse(readFileSync(join(CONTENT_DIR, `${key}.json`), "utf8")),
  );
}

const iso = readContent("iso45001");
const compliance = readContent("compliance");
const files = [iso, compliance];

function item(file: ContentFile, sectionKey: string, label: string) {
  const found = file.items.find(
    (candidate) => candidate.sectionKey === sectionKey && candidate.label === label,
  );
  if (!found) throw new Error(`no item ${sectionKey} ${label}`);
  return found;
}

function everyText(file: ContentFile): { de: string; en: string }[] {
  return [
    file.title,
    ...file.sections.flatMap((section) => [
      section.title,
      ...section.groups.map((group) => group.title),
    ]),
    ...file.items.flatMap((entry) => [
      entry.title,
      entry.question,
      ...(entry.requirement ? [entry.requirement] : []),
    ]),
  ];
}

describe("the catalogue and the files on disk (spec 0019, AC-2)", () => {
  it("lists exactly the content files committed", () => {
    const onDisk = readdirSync(CONTENT_DIR)
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/, ""))
      .sort();
    expect(onDisk).toEqual([...QUESTIONNAIRE_KEYS].sort());
  });

  it("parses each file with the content schema and its key matches the file name", () => {
    for (const key of QUESTIONNAIRE_KEYS) expect(readContent(key).key).toBe(key);
  });

  it("allows section exclusion for the technical standards only", () => {
    expect(QUESTIONNAIRES.compliance.allowsSectionExclusion).toBe(true);
    expect(QUESTIONNAIRES.iso45001.allowsSectionExclusion).toBe(false);
  });
});

describe("the ISO 45001 file (spec 0019, AC-1)", () => {
  it("holds 7 sections and 60 items in document order: 27 clauses, 33 annex sub items, 19 of them rateable", () => {
    expect(iso.version).toBe(1);
    expect(iso.sections.map((section) => section.key)).toEqual([
      "c4",
      "c5",
      "c6",
      "c7",
      "c8",
      "c9",
      "c10",
    ]);
    expect(iso.sections.every((section) => section.groups.length === 0)).toBe(true);
    expect(iso.items).toHaveLength(60);
    expect(iso.items.filter((entry) => entry.parentPosition === null)).toHaveLength(27);
    const subItems = iso.items.filter((entry) => entry.parentPosition !== null);
    expect(subItems).toHaveLength(33);
    expect(subItems.filter((entry) => entry.rateable)).toHaveLength(19);
    expect(
      iso.items.filter((entry) => entry.parentPosition === null).every((entry) => entry.rateable),
    ).toBe(true);
  });

  it("numbers the annex items under their clause", () => {
    const annexA = iso.items.filter((entry) => entry.label.startsWith("A."));
    expect(annexA.map((entry) => entry.label)).toEqual(
      Array.from({ length: 18 }, (_, i) => `A.${i + 1}`),
    );
    expect(new Set(annexA.map((entry) => entry.parentPosition))).toEqual(
      new Set([item(iso, "c6", "6.1.2.1").position]),
    );
    expect(iso.items.filter((entry) => entry.label.startsWith("B."))).toHaveLength(9);
    expect(iso.items.filter((entry) => entry.label.startsWith("C."))).toHaveLength(6);
    expect(
      new Set(
        iso.items
          .filter((entry) => entry.label.startsWith("C."))
          .map((entry) => entry.parentPosition),
      ),
    ).toEqual(new Set([item(iso, "c7", "7.3").position]));
    // An annex item follows its clause directly, before the next clause.
    expect(iso.items[10]?.label).toBe("A.1");
    expect(iso.items[28]?.label).toBe("6.1.3");
  });

  it("carries the label fix: 7.5 without the trailing dot", () => {
    expect(iso.items.some((entry) => entry.label === "7.5")).toBe(true);
    expect(iso.items.some((entry) => entry.label === "7.5.")).toBe(false);
  });

  it("says OH&S where the quality template said quality or customer satisfaction", () => {
    expect(item(iso, "c4", "4.3").title.en).toBe(
      "Determining the scope of the OH&S management system",
    );
    expect(item(iso, "c5", "5.2").question.en).toContain("continually improving OH&S performance?");
    expect(item(iso, "c5", "5.2").question.en).toContain("Is it available to interested parties?");
    expect(item(iso, "c6", "6.2.1").requirement?.en).toContain(
      "are relevant to the OH&S policy and to the improvement of OH&S performance",
    );
    expect(item(iso, "c7", "7.4").question.en).toContain(
      "communications with workers, contractors, visitors and other interested parties about OH&S matters",
    );
    expect(item(iso, "c7", "7.5").question.en).toContain("OH&S policy, objectives, KPI");
    expect(item(iso, "c9", "9.1.1").question.en).toContain(
      "other measures of OH&S performance defined",
    );
    expect(item(iso, "c9", "9.1.1").question.en).toContain(
      "measurements are driving OH&S performance",
    );
    expect(item(iso, "c9", "9.3").question.en).toContain("matters related to OH&S.");
    expect(item(iso, "c9", "9.3").question.en).toContain("can also include an OH&S focus");
    expect(item(iso, "c10", "10.1").question.en).toContain("Do they improve OH&S performance?");
    for (const text of everyText(iso)) {
      expect(text.en).not.toMatch(/quality|customer/i);
    }
  });

  it("gives 5.4 its own requirement and fixes the two typos", () => {
    expect(item(iso, "c5", "5.4").requirement?.en).toMatch(
      /^Establish, implement and maintain a process for consultation and participation of workers/,
    );
    expect(item(iso, "c5", "5.4").requirement?.en).not.toEqual(
      item(iso, "c5", "5.2").requirement?.en,
    );
    expect(item(iso, "c5", "5.4").question.en).toContain("attendance");
    expect(item(iso, "c5", "5.2").requirement?.en).toContain(
      "continual improvement of the OH&S management system",
    );
    for (const text of everyText(iso)) expect(text.en).not.toContain("OHO&S");
  });
});

describe("the technical standards file (spec 0019, AC-1)", () => {
  it("holds 18 sections with 42 groups and 327 rateable top level items", () => {
    expect(compliance.version).toBe(1);
    expect(compliance.sections).toHaveLength(18);
    expect(compliance.sections.reduce((count, section) => count + section.groups.length, 0)).toBe(
      42,
    );
    expect(compliance.items).toHaveLength(327);
    expect(
      compliance.items.every(
        (entry) => entry.rateable && entry.parentPosition === null && entry.groupKey !== null,
      ),
    ).toBe(true);
    expect(compliance.sections.map((section) => section.key)).toEqual([
      "electrical_safety",
      "fire_protection_storage",
      "ppe",
      "industrial_hygiene_sampling",
      "projects",
      "security",
      "line_breaking",
      "hot_work",
      "confined_space",
      "high_work",
      "excavation",
      "loto",
      "explosion_protection",
      "mechanical_integrity",
      "moc_pssr",
      "incident_investigation",
      "contractor_management",
      "effective_communication",
    ]);
  });

  it("restores the collapsed labels at their positions in the ten affected standards", () => {
    const restored = compliance.items
      .filter((entry) => /0$/.test(entry.label))
      .map((entry) => `${entry.sectionKey} ${entry.position}:${entry.label}`);
    expect(restored).toEqual([
      "electrical_safety 14:2.10",
      "fire_protection_storage 31:1.10",
      "fire_protection_storage 41:1.20",
      "ppe 84:1.10",
      "line_breaking 150:1.10",
      "hot_work 164:1.10",
      "confined_space 178:1.10",
      "confined_space 188:1.20",
      "high_work 206:1.10",
      "excavation 224:1.10",
      "excavation 234:1.20",
      "loto 244:1.10",
      "incident_investigation 300:1.10",
    ]);
    // No label repeats within a group once restored.
    for (const section of compliance.sections) {
      for (const group of section.groups) {
        const labels = compliance.items
          .filter((entry) => entry.groupKey === group.key)
          .map((entry) => entry.label);
        expect(new Set(labels).size, group.key).toBe(labels.length);
      }
    }
  });

  it("says hot work in Hot Work 1.1, not line breaking", () => {
    const hotWork = item(compliance, "hot_work", "1.1");
    expect(hotWork.title.en).toBe("Facility guideline shall be in place for hot work");
    expect(hotWork.requirement?.en).toBe("Facility guideline shall be in place for hot work");
    expect(hotWork.question.en).toBe("Is there a facility guideline in place for hot work?");
    for (const entry of compliance.items.filter(
      (candidate) => candidate.sectionKey === "hot_work",
    )) {
      expect(entry.title.en).not.toMatch(/line breaking/i);
    }
  });

  it("gives Electrical 3.3 a requirement and a question", () => {
    const electrical = item(compliance, "electrical_safety", "3.3");
    expect(electrical.requirement?.en).toBe(
      "A program is in place to check ground fault circuit interrupters (GFCI in the USA, DR in Brazil, FI in Switzerland) or the country specific equivalent at the defined interval.",
    );
    expect(electrical.question.en).toBe(
      "Is there a program to check ground fault circuit interrupters (or the country specific equivalent) at a defined interval, with records?",
    );
    expect(compliance.items.every((entry) => entry.requirement !== null)).toBe(true);
  });

  it("never names the company the checklist was written for", () => {
    expect(item(compliance, "security", "1.6").title.en).toContain(
      "people who are not employees of the company",
    );
    expect(item(compliance, "security", "1.6").requirement?.en).toContain(
      "escorted by an employee of the company",
    );
    expect(item(compliance, "security", "1.7").requirement?.en).toContain(
      "all employees of the company",
    );
    for (const file of files) {
      for (const text of everyText(file)) {
        expect(text.en).not.toContain("Lonza");
        expect(text.de).not.toContain("Lonza");
      }
    }
  });
});

describe("both languages (spec 0019, AC-1)", () => {
  it("carries a non empty German and English for every text, in Swiss spelling", () => {
    for (const file of files) {
      for (const text of everyText(file)) {
        expect(text.de.trim().length).toBeGreaterThan(0);
        expect(text.en.trim().length).toBeGreaterThan(0);
        expect(text.de).not.toContain("ß");
      }
    }
  });

  it("flags every item's German with a review state, and no committed text is still English", () => {
    for (const file of files) {
      for (const entry of file.items) {
        expect(typeof entry.deReviewed).toBe("boolean");
        // A drafted German that equals its English source is a missing translation, not a match.
        expect(entry.question.de, `${file.key} ${entry.position}`).not.toBe(entry.question.en);
      }
      expect(file.sourceNote).toMatch(/^Built from .+\.html/);
    }
  });
});
