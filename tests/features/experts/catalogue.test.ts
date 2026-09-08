import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AVAILABILITY_CODES,
  EXPERT_CATALOGUE,
  EXPERT_LIST_NAMES,
  type ExpertListName,
  isPhotoMimeType,
  PHOTO_MAX_BYTES,
  PHOTO_TYPES,
} from "@/features/experts/catalogue";

/**
 * The catalogue equality test (spec 0013, AC-1). Every coded list lives in three places: this
 * catalogue, the `<@` check constraints in the schema file, and the label keys in both message
 * catalogs. Nothing stops those drifting except a test, and a drift is not a cosmetic problem: a
 * code the database rejects but the form offers is a save the expert cannot explain, and a code
 * the database accepts but the catalogue omits renders as a blank badge on the client's card.
 *
 * The schema file is the source read here rather than the migration, because the schema file is
 * what a later change edits; a migration is a historical record.
 */

const SCHEMA = readFileSync(join(process.cwd(), "supabase/schemas/13_expert_profiles.sql"), "utf8");

/**
 * The codes of one `<@ array[...]` check constraint in the schema file. Whitespace tolerant on
 * purpose: the SQL formatter wraps the canton and NOGA lists across several lines, and a parser
 * that assumed one line would quietly find nothing and pass.
 */
function constraintCodes(column: string): readonly string[] {
  const start = SCHEMA.indexOf(`${column} <@ array[`);
  if (start === -1) throw new Error(`no <@ array[...] check found for ${column}`);
  const open = SCHEMA.indexOf("[", start);
  const close = SCHEMA.indexOf("]", open);
  if (close === -1) throw new Error(`unterminated array literal for ${column}`);
  return [...SCHEMA.slice(open + 1, close).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

/** The values of one `in (...)` check constraint, for the single value columns. */
function inListCodes(column: string): readonly string[] {
  const pattern = new RegExp(`${column} in \\(([^)]*)\\)`);
  const match = SCHEMA.match(pattern);
  if (!match?.[1]) throw new Error(`no in (...) check found for ${column}`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

describe("the expert catalogue (spec 0013, AC-1)", () => {
  it.each(EXPERT_LIST_NAMES)(
    "holds exactly the codes the %s check constraint allows",
    (list: ExpertListName) => {
      expect([...constraintCodes(list)].sort()).toEqual([...EXPERT_CATALOGUE[list]].sort());
    },
  );

  it("holds exactly the availability values the check constraint allows", () => {
    expect([...inListCodes("availability")].sort()).toEqual([...AVAILABILITY_CODES].sort());
  });

  it("reads every list, so a renamed column fails rather than silently passing", () => {
    // The parser returns nothing for an unknown column, and an empty list would otherwise compare
    // equal to an empty catalogue entry. This is the guard on the guard.
    expect(() => constraintCodes("not_a_column")).toThrow();
    for (const list of EXPERT_LIST_NAMES) {
      expect(constraintCodes(list).length).toBeGreaterThan(0);
    }
  });

  it("covers all 26 cantons and all 21 NOGA sections", () => {
    expect(EXPERT_CATALOGUE.regions).toHaveLength(26);
    expect(EXPERT_CATALOGUE.industries).toHaveLength(21);
  });

  it("carries no duplicate code in any list", () => {
    for (const list of EXPERT_LIST_NAMES) {
      const codes = EXPERT_CATALOGUE[list];
      expect(new Set(codes).size).toBe(codes.length);
    }
  });

  it("names no retired standard: OHSAS 18001 was withdrawn in 2021", () => {
    expect(EXPERT_CATALOGUE.standards).not.toContain("ohsas_18001");
  });
});

describe("the photo rules (spec 0013, AC-6)", () => {
  it("caps an upload at the same 2 MB the bucket does", () => {
    expect(PHOTO_MAX_BYTES).toBe(2 * 1024 * 1024);
  });

  it("maps each accepted type to the extension the object path uses", () => {
    expect(PHOTO_TYPES).toEqual({
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    });
  });

  it("accepts only those three types", () => {
    expect(isPhotoMimeType("image/jpeg")).toBe(true);
    expect(isPhotoMimeType("image/png")).toBe(true);
    expect(isPhotoMimeType("image/webp")).toBe(true);
    expect(isPhotoMimeType("image/gif")).toBe(false);
    expect(isPhotoMimeType("image/svg+xml")).toBe(false);
    expect(isPhotoMimeType("application/pdf")).toBe(false);
    expect(isPhotoMimeType("")).toBe(false);
  });

  it("keeps the extensions to those the photo_path check constraint allows", () => {
    // The column check is `^<expert_id>/photo\.(jpg|png|webp)$`; an extension the action could
    // produce but the column rejects would fail the write after the upload had already happened.
    const allowed = SCHEMA.match(/photo\\\.\(([a-z|]+)\)/)?.[1]?.split("|") ?? [];
    expect(allowed.sort()).toEqual([...new Set(Object.values(PHOTO_TYPES))].sort());
  });
});
