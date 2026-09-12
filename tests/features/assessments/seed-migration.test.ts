import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_KEYS } from "@/features/assessments/catalogue";
import { type ContentFile, contentFileSchema } from "@/features/assessments/content-schema";
import {
  renderItemUpsert,
  renderQuestionnaireMigration,
  renderVersionUpsert,
} from "@/features/assessments/seed-migration";

/**
 * The seed migration renderer (spec 0019, AC-2): pure, one upsert per row, never a delete,
 * parents before children, byte stable on a rerun, and the committed migration equals the
 * committed content files, so the JSON and the seed rows can never drift apart.
 */

const CONTENT_DIR = join(process.cwd(), "src/features/assessments/content");
const MIGRATIONS_DIR = join(process.cwd(), "supabase/migrations");
const GENERATED_AT = new Date("2026-09-12T08:00:00.000Z");

const files: ContentFile[] = QUESTIONNAIRE_KEYS.map((key) =>
  contentFileSchema.parse(JSON.parse(readFileSync(join(CONTENT_DIR, `${key}.json`), "utf8"))),
);

const sample: ContentFile = {
  key: "iso45001",
  version: 1,
  title: { de: "Titel", en: "Title" },
  sourceNote: "Built from it's file",
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
      groupKey: "c4.1",
      parentPosition: null,
      rateable: true,
      title: { de: "Titel", en: "Title" },
      requirement: { de: "Anforderung", en: "Requirement" },
      question: { de: "Frage?", en: "Question?" },
      deReviewed: false,
    },
    {
      position: 2,
      label: "A.1",
      sectionKey: "c4",
      groupKey: null,
      parentPosition: 1,
      rateable: false,
      title: { de: "a) Zeile", en: "a) line" },
      requirement: null,
      question: { de: "a) Zeile", en: "a) line" },
      deReviewed: true,
    },
  ],
};

/** The migration without its generated timestamp line, so two renders can be compared. */
function withoutStamp(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^-- \d{4}-\d{2}-\d{2}T/.test(line))
    .join("\n");
}

describe("renderVersionUpsert (spec 0019, AC-2)", () => {
  it("upserts the version row keyed on its key with the outline as jsonb and the item count", () => {
    const sql = renderVersionUpsert(sample);
    expect(sql).toContain(
      "insert into public.questionnaire_versions (key, questionnaire_key, version, title, sections, item_count, source_note)",
    );
    expect(sql).toContain(
      'values (\'iso45001@1\', \'iso45001\', 1, \'{"de":"Titel","en":"Title"}\'::jsonb, ',
    );
    expect(sql).toContain(
      '"groups":[{"key":"c4.1","label":"1","title":{"de":"Gruppe","en":"Group"}}]',
    );
    expect(sql).toContain(", 2, 'Built from it''s file')");
    expect(sql).toContain(
      "on conflict (key) do update set questionnaire_key = excluded.questionnaire_key",
    );
    expect(sql).not.toContain("key = excluded.key");
  });
});

describe("renderItemUpsert (spec 0019, AC-2)", () => {
  it("writes the id and the parent id from the version key and the positions", () => {
    const parent = sample.items[0];
    const child = sample.items[1];
    if (!parent || !child) throw new Error("sample items missing");
    expect(renderItemUpsert("iso45001@1", parent)).toContain(
      "values ('iso45001@1/1', 'iso45001@1', 1, null, 'c4', 'c4.1', '4.1', true, ",
    );
    expect(renderItemUpsert("iso45001@1", child)).toContain(
      "values ('iso45001@1/2', 'iso45001@1', 2, 'iso45001@1/1', 'c4', null, 'A.1', false, ",
    );
    expect(renderItemUpsert("iso45001@1", child)).toContain(
      ', null, \'{"de":"a) Zeile","en":"a) line"}\'::jsonb, true)',
    );
    expect(renderItemUpsert("iso45001@1", parent)).toContain(
      "on conflict (id) do update set version_key = excluded.version_key",
    );
  });
});

describe("renderQuestionnaireMigration (spec 0019, AC-2)", () => {
  it("renders one upsert per version and per item, never a delete, parents before children", () => {
    const sql = renderQuestionnaireMigration(files, GENERATED_AT);
    const versions = sql.match(/^insert into public\.questionnaire_versions/gm) ?? [];
    const items = sql.match(/^insert into public\.questionnaire_items/gm) ?? [];
    expect(versions).toHaveLength(files.length);
    expect(items).toHaveLength(files.reduce((count, file) => count + file.items.length, 0));
    expect(sql).not.toMatch(/^delete /m);
    expect(sql).not.toMatch(/^truncate /m);
    for (const file of files) {
      for (const entry of file.items) {
        if (entry.parentPosition === null) continue;
        const childAt = sql.indexOf(`values ('${file.key}@${file.version}/${entry.position}', `);
        const parentAt = sql.indexOf(
          `values ('${file.key}@${file.version}/${entry.parentPosition}', `,
        );
        expect(parentAt).toBeGreaterThan(-1);
        expect(parentAt).toBeLessThan(childAt);
      }
    }
  });

  it("is byte stable on a rerun with the same content", () => {
    const first = renderQuestionnaireMigration(files, GENERATED_AT);
    const second = renderQuestionnaireMigration(
      files.map((file) => ({ ...file, items: [...file.items].reverse() })),
      GENERATED_AT,
    );
    expect(second).toBe(first);
  });

  it("matches the committed seed migration, so the JSON and the seed rows are equal", () => {
    const seeds = readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith("_questionnaire_seed.sql"))
      .sort();
    const newest = seeds.at(-1);
    if (!newest) throw new Error("no questionnaire seed migration committed");
    const committed = readFileSync(join(MIGRATIONS_DIR, newest), "utf8");
    expect(withoutStamp(committed)).toBe(
      withoutStamp(renderQuestionnaireMigration(files, GENERATED_AT)),
    );
  });
});
