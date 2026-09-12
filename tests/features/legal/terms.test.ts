import { describe, expect, it } from "vitest";
import de from "@/../messages/de-CH.json";
import en from "@/../messages/en-CH.json";
import { CURRENT_TERMS_VERSION, TERMS_VERSIONS, termsAreCurrent } from "@/features/legal/terms";

const CATALOGUES = [
  ["en-CH", en],
  ["de-CH", de],
] as const;

/** The terms version and the re consent comparison (spec 0015, AC-10). */
describe("terms version", () => {
  it("is at version 2 since the purchased contacts clause (spec 0018, AC-16)", () => {
    // Version 1 shipped first so nobody was stale on the day spec 0015 deployed; version 2 is the
    // one deliberate bump so far, and it puts the dialog in front of every signed in user once.
    expect(CURRENT_TERMS_VERSION).toBe("2");
  });

  it("names the current version as the newest entry in the version list", () => {
    expect(TERMS_VERSIONS.at(-1)).toBe(CURRENT_TERMS_VERSION);
    expect(TERMS_VERSIONS).toContain(CURRENT_TERMS_VERSION);
  });

  it("has no duplicate versions", () => {
    expect(new Set(TERMS_VERSIONS).size).toBe(TERMS_VERSIONS.length);
  });
});

/**
 * The changelog contract: every version from '1' up has a key in both catalogues, so a bump that
 * forgets to say what changed fails here rather than showing an empty dialog to every user.
 */
describe("terms changelog", () => {
  for (const [name, catalogue] of CATALOGUES) {
    it(`explains every version in ${name}`, () => {
      const changelog: Record<string, unknown> = catalogue.legal.terms.changelog;
      for (const version of TERMS_VERSIONS) {
        const entry = changelog[version];
        expect(typeof entry, `legal.terms.changelog.${version} is missing in ${name}`).toBe(
          "string",
        );
        expect((entry as string).trim().length).toBeGreaterThan(0);
      }
    });

    it(`has no changelog entry in ${name} for a version that was never in force`, () => {
      // The other direction: an entry with no version is a bump that was started and abandoned,
      // and it would sit in the catalogue looking like documentation of something real.
      const changelog: Record<string, unknown> = catalogue.legal.terms.changelog;
      expect(Object.keys(changelog).sort()).toEqual([...TERMS_VERSIONS].sort());
    });
  }

  it("says the same thing about the same versions in both languages", () => {
    expect(Object.keys(en.legal.terms.changelog).sort()).toEqual(
      Object.keys(de.legal.terms.changelog).sort(),
    );
  });
});

/**
 * The comparison itself. Equality, never ordering: the column is `text`, so `'10' < '2'` and any
 * ordering comparison would treat a tenth version as older than a second one and let a stale
 * profile straight past the gate.
 */
describe("termsAreCurrent", () => {
  it("accepts exactly the current version", () => {
    expect(termsAreCurrent(CURRENT_TERMS_VERSION)).toBe(true);
  });

  it("treats a profile with no version as stale", () => {
    expect(termsAreCurrent(null)).toBe(false);
    expect(termsAreCurrent(undefined)).toBe(false);
    expect(termsAreCurrent("")).toBe(false);
  });

  it("treats an unknown or future version as stale rather than assuming", () => {
    expect(termsAreCurrent("99")).toBe(false);
    expect(termsAreCurrent("2026-01")).toBe(false);
  });

  it("compares by equality, so a version that sorts below the current one is still stale", () => {
    // The trap the column type sets: as text, '10' < '2'. If the comparison were an ordering, a
    // profile at '10' against a current '2' would read as "already newer" or "already older"
    // depending on the direction, and one of those silently skips the gate.
    const stale = ["10", "0", "1.0", " 1", "1 "];
    for (const version of stale) {
      if (version === CURRENT_TERMS_VERSION) continue;
      expect(termsAreCurrent(version), `${version} must be stale`).toBe(false);
    }
  });

  it("is not fooled by a number that looks like the current version", () => {
    // The column is text and the constant is a string; a numeric coercion anywhere in this path
    // would make 1 and '1' agree, and the database can only ever return the string.
    expect(termsAreCurrent(1 as unknown as string)).toBe(false);
  });
});
