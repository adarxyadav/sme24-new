import { describe, expect, it } from "vitest";
import { profileFormDefaults } from "@/features/experts/form";
import type { ExpertProfile } from "@/features/experts/queries";
import { expertProfileSchema, todayInZurich } from "@/features/experts/schema";

/**
 * The profile form's prefill (spec 0013, AC-5). Two pages fill the same form from the same row —
 * the expert's own `/expert/profile` and the ops page — so a field that drifted here would show
 * one caller a value the other never sees. The round trip matters as much as the mapping: a
 * prefilled form submitted untouched has to parse back to exactly the row it came from, or simply
 * opening the page and pressing save would rewrite columns nobody edited. Pure.
 */

const EXPERT_ID = "0e000000-0000-4000-8000-00000000000a";

/**
 * A stored `expert_profiles` row, overridable per test. Typed rather than cast, so a column that
 * is renamed or added in a migration fails this file at `pnpm typecheck` instead of leaving the
 * assertions quietly checking a shape the table no longer has.
 */
function profile(overrides: Partial<ExpertProfile> = {}): ExpertProfile {
  return {
    expert_id: EXPERT_ID,
    email: "rita@example.test",
    headline: "EHS lead",
    bio: "Twenty years on site.",
    competencies: ["compliance"],
    industries: ["C"],
    standards: ["iso_45001"],
    languages: ["de", "en"],
    regions: ["ZH", "AG"],
    availability: "available",
    available_from: "2026-12-01",
    availability_note: "From December",
    years_experience: 20,
    phone: "+41 44 123 45 67",
    photo_path: null,
    status: "active",
    invited_by: null,
    invited_at: "2026-09-07T10:00:00.000Z",
    onboarded_at: "2026-09-07T11:00:00.000Z",
    deactivated_at: null,
    created_at: "2026-09-07T10:00:00.000Z",
    updated_at: "2026-09-07T11:00:00.000Z",
    ...overrides,
  };
}

describe("prefilling the profile form", () => {
  it("carries every stored value across", () => {
    expect(profileFormDefaults(profile())).toEqual({
      headline: "EHS lead",
      bio: "Twenty years on site.",
      competencies: ["compliance"],
      industries: ["C"],
      standards: ["iso_45001"],
      languages: ["de", "en"],
      regions: ["ZH", "AG"],
      availability: "available",
      availableFrom: "2026-12-01",
      availabilityNote: "From December",
      yearsExperience: "20",
      phone: "+41 44 123 45 67",
    });
  });

  it("turns every null column into an empty field, because a form field holds a string", () => {
    const defaults = profileFormDefaults(
      profile({
        headline: null,
        bio: null,
        available_from: null,
        availability_note: null,
        years_experience: null,
        phone: null,
      }),
    );
    expect(defaults).toMatchObject({
      headline: "",
      bio: "",
      availableFrom: "",
      availabilityNote: "",
      yearsExperience: "",
      phone: "",
    });
  });

  it("shows a null years count as an empty box, not a zero", () => {
    // A zero is a claim ("no experience"); an empty box is the absence of one. Rendering null as
    // "0" would put a figure on the ops page the expert never entered.
    expect(profileFormDefaults(profile({ years_experience: null })).yearsExperience).toBe("");
    expect(profileFormDefaults(profile({ years_experience: 0 })).yearsExperience).toBe("0");
  });

  it("drops a stored code the catalogue has since retired", () => {
    // The bug this prevents: a retired code carried into the form is a value the schema rejects on
    // submit, so the expert faces an error on a field they never touched and cannot clear.
    const defaults = profileFormDefaults(
      profile({
        standards: ["iso_45001", "ohsas_18001"],
        regions: ["ZH", "XX"],
        languages: ["de", "es"],
        industries: ["C", "Z"],
        competencies: ["compliance", "gone"],
      }),
    );
    expect(defaults.standards).toEqual(["iso_45001"]);
    expect(defaults.regions).toEqual(["ZH"]);
    expect(defaults.languages).toEqual(["de"]);
    expect(defaults.industries).toEqual(["C"]);
    expect(defaults.competencies).toEqual(["compliance"]);
  });

  it("keeps an empty list empty rather than inventing a default", () => {
    const defaults = profileFormDefaults(profile({ industries: [], standards: [] }));
    expect(defaults.industries).toEqual([]);
    expect(defaults.standards).toEqual([]);
  });
});

describe("the round trip", () => {
  it("parses a full prefill straight back to the row it came from", () => {
    const row = profile();
    const parsed = expertProfileSchema("2026-09-08").parse(profileFormDefaults(row));
    expect(parsed).toMatchObject({
      headline: row.headline,
      bio: row.bio,
      competencies: row.competencies,
      industries: row.industries,
      standards: row.standards,
      languages: row.languages,
      regions: row.regions,
      availability: row.availability,
      availableFrom: row.available_from,
      availabilityNote: row.availability_note,
      yearsExperience: row.years_experience,
      phone: row.phone,
    });
  });

  it("parses an all null prefill back to all nulls, not to empty strings", () => {
    const row = profile({
      bio: null,
      available_from: null,
      availability_note: null,
      years_experience: null,
      phone: null,
    });
    const parsed = expertProfileSchema(todayInZurich()).parse(profileFormDefaults(row));
    expect(parsed).toMatchObject({
      bio: null,
      availableFrom: null,
      availabilityNote: null,
      yearsExperience: null,
      phone: null,
    });
  });

  it("leaves a past available_from parseable only while today has not overtaken it", () => {
    // A stored date that has since passed is the one field a prefill cannot round trip: the schema
    // refuses it. The form shows the error, which is the honest answer — the date really is past.
    const row = profile({ available_from: "2026-01-01" });
    expect(expertProfileSchema("2026-09-08").safeParse(profileFormDefaults(row)).success).toBe(
      false,
    );
    expect(expertProfileSchema("2025-12-01").safeParse(profileFormDefaults(row)).success).toBe(
      true,
    );
  });
});
