import { describe, expect, it } from "vitest";
import {
  ALL_STATUSES,
  assignExpertSchema,
  endAssignmentSchema,
  expertFiltersSchema,
  expertIdSchema,
  expertListQuery,
  expertProfileSchema,
  inviteExpertSchema,
  onboardingSchema,
  opsNotesSchema,
  todayInZurich,
} from "@/features/experts/schema";

/**
 * The boundary schemas of the expert feature (spec 0013). Every action parses its input with one
 * of these, so a rule that stops holding here is a rule the database check constraints have to
 * catch instead — an unexplained 500 rather than a message beside the field. The message strings
 * are `experts.form.errors.*` keys, and the catalogue test proves those keys exist; these tests
 * prove the right key is raised for the right input. Pure, no boundaries to mock.
 */

const UUID = "0e000000-0000-4000-8000-00000000000a";

/** The first message of a failed parse, which is the key the form renders. */
function firstIssue(result: {
  success: boolean;
  error?: { issues: readonly { message: string }[] };
}) {
  return result.error?.issues[0]?.message;
}

describe("the ops list filter", () => {
  it("defaults to every status and no cursor", () => {
    expect(expertFiltersSchema.parse({})).toEqual({ status: ALL_STATUSES });
  });

  it("keeps a real status and a cursor", () => {
    expect(
      expertFiltersSchema.parse({ status: "invited", cursor: "2026-09-07T10:00:00Z" }),
    ).toEqual({ status: "invited", cursor: "2026-09-07T10:00:00Z" });
  });

  it("falls back rather than failing on a value from the URL", () => {
    // `catch` rather than an error, because these come from a query string anyone can edit and a
    // thrown parse there would be a crashed page, not a corrected filter.
    expect(expertFiltersSchema.parse({ status: "banned" }).status).toBe(ALL_STATUSES);
    expect(expertFiltersSchema.parse({ cursor: "x".repeat(500) }).cursor).toBeUndefined();
  });
});

describe("the list query string", () => {
  it("is empty when nothing is filtered, so the default page has a clean URL", () => {
    expect(expertListQuery({ status: ALL_STATUSES })).toBe("");
  });

  it("carries the status, the cursor, or both", () => {
    expect(expertListQuery({ status: "active" })).toBe("?status=active");
    expect(expertListQuery({ status: ALL_STATUSES }, "c1")).toBe("?cursor=c1");
    expect(expertListQuery({ status: "inactive" }, "c1")).toBe("?status=inactive&cursor=c1");
  });

  it("drops a null or empty cursor", () => {
    expect(expertListQuery({ status: ALL_STATUSES }, null)).toBe("");
    expect(expertListQuery({ status: ALL_STATUSES }, "")).toBe("");
  });
});

describe("the invite form", () => {
  const valid = { email: "  Rita.Meier@Example.TEST ", fullName: "  Rita Meier  ", locale: "de" };

  it("trims and lowercases the address, so one person is never two invites", () => {
    const parsed = inviteExpertSchema.parse(valid);
    expect(parsed).toEqual({
      email: "rita.meier@example.test",
      fullName: "Rita Meier",
      locale: "de",
    });
  });

  it("accepts an address pasted with surrounding whitespace", () => {
    // The regression this guards: `z.email().trim()` validates first and trims afterwards, so a
    // trailing space — what a paste from a mail client or a spreadsheet cell carries — was refused
    // as an invalid address. The trim has to happen before the check, as it does in auth and
    // marketing.
    expect(inviteExpertSchema.parse({ ...valid, email: "rita@example.test " }).email).toBe(
      "rita@example.test",
    );
    expect(inviteExpertSchema.parse({ ...valid, email: "\trita@example.test\n" }).email).toBe(
      "rita@example.test",
    );
  });

  it("names the field that is wrong", () => {
    expect(firstIssue(inviteExpertSchema.safeParse({ ...valid, email: "rita" }))).toBe(
      "emailInvalid",
    );
    expect(firstIssue(inviteExpertSchema.safeParse({ ...valid, fullName: "   " }))).toBe(
      "fullNameRequired",
    );
    expect(firstIssue(inviteExpertSchema.safeParse({ ...valid, fullName: "R".repeat(201) }))).toBe(
      "fullNameLong",
    );
    expect(
      firstIssue(inviteExpertSchema.safeParse({ ...valid, email: `${"a".repeat(320)}@e.test` })),
    ).toBe("emailLong");
  });

  it("takes only the two app locales", () => {
    expect(inviteExpertSchema.safeParse({ ...valid, locale: "fr" }).success).toBe(false);
  });

  it("has no role field at all, because the action hard codes it", () => {
    const parsed = inviteExpertSchema.parse({ ...valid, role: "ops" }) as Record<string, unknown>;
    expect(parsed.role).toBeUndefined();
  });
});

describe("the id schemas", () => {
  it("take a uuid and nothing else", () => {
    expect(expertIdSchema.safeParse({ expertId: UUID }).success).toBe(true);
    expect(expertIdSchema.safeParse({ expertId: "1" }).success).toBe(false);
    expect(endAssignmentSchema.safeParse({ assignmentId: UUID }).success).toBe(true);
    expect(endAssignmentSchema.safeParse({ assignmentId: "" }).success).toBe(false);
  });

  it("name the missing organization on the assign form", () => {
    expect(assignExpertSchema.safeParse({ expertId: UUID, organizationId: "" }).success).toBe(
      false,
    );
    expect(firstIssue(assignExpertSchema.safeParse({ expertId: UUID, organizationId: "" }))).toBe(
      "organizationRequired",
    );
  });
});

describe("the ops notes", () => {
  it("allows an empty note, because clearing one is normal", () => {
    expect(opsNotesSchema.parse({ expertId: UUID })).toEqual({ expertId: UUID, notes: "" });
    expect(opsNotesSchema.parse({ expertId: UUID, notes: "   " }).notes).toBe("");
  });

  it("trims and caps the text", () => {
    expect(opsNotesSchema.parse({ expertId: UUID, notes: "  careful  " }).notes).toBe("careful");
    expect(firstIssue(opsNotesSchema.safeParse({ expertId: UUID, notes: "n".repeat(4001) }))).toBe(
      "notesLong",
    );
  });
});

describe("the onboarding form (AC-4)", () => {
  const valid = {
    termsAccepted: true,
    fullName: "Rita Meier",
    headline: "EHS lead, 20 years on site",
    languages: ["de"],
    regions: ["ZH"],
  };

  it("accepts the shortest complete answer", () => {
    expect(onboardingSchema.parse(valid)).toMatchObject(valid);
  });

  it("refuses an unticked consent box without failing to type it as a boolean", () => {
    expect(firstIssue(onboardingSchema.safeParse({ ...valid, termsAccepted: false }))).toBe(
      "termsRequired",
    );
  });

  it("insists on a language and a region, because neither can be matched without them", () => {
    expect(firstIssue(onboardingSchema.safeParse({ ...valid, languages: [] }))).toBe(
      "languagesRequired",
    );
    expect(firstIssue(onboardingSchema.safeParse({ ...valid, regions: [] }))).toBe(
      "regionsRequired",
    );
  });

  it("takes only catalogue codes", () => {
    expect(onboardingSchema.safeParse({ ...valid, languages: ["es"] }).success).toBe(false);
    expect(onboardingSchema.safeParse({ ...valid, regions: ["XX"] }).success).toBe(false);
  });

  it("caps the headline at the length the column allows", () => {
    expect(firstIssue(onboardingSchema.safeParse({ ...valid, headline: "h".repeat(121) }))).toBe(
      "headlineLong",
    );
    expect(onboardingSchema.safeParse({ ...valid, headline: "h".repeat(120) }).success).toBe(true);
  });

  it("asks nothing the full profile asks, beyond these five", () => {
    // Onboarding is deliberately shorter than the profile: everything else can wait.
    expect(Object.keys(onboardingSchema.shape).sort()).toEqual(
      ["fullName", "headline", "languages", "locale", "regions", "termsAccepted"].sort(),
    );
  });
});

describe("the full profile form (AC-5)", () => {
  const TODAY = "2026-09-08";
  const schema = expertProfileSchema(TODAY);
  const valid = {
    headline: "EHS lead",
    bio: "",
    competencies: ["compliance"],
    industries: [],
    standards: [],
    languages: ["de"],
    regions: ["ZH"],
    availability: "available",
    availableFrom: "",
    availabilityNote: "",
    yearsExperience: "",
    phone: "",
  };

  it("turns every blank optional field into null, so an untouched field round trips", () => {
    expect(schema.parse(valid)).toMatchObject({
      bio: null,
      availableFrom: null,
      availabilityNote: null,
      yearsExperience: null,
      phone: null,
    });
  });

  it("keeps the values that were filled in", () => {
    expect(
      schema.parse({
        ...valid,
        bio: "  Twenty years of site work.  ",
        availableFrom: "2026-12-01",
        availabilityNote: " From December ",
        yearsExperience: "20",
        phone: " +41 44 123 45 67 ",
      }),
    ).toMatchObject({
      bio: "Twenty years of site work.",
      availableFrom: "2026-12-01",
      availabilityNote: "From December",
      yearsExperience: 20,
      phone: "+41 44 123 45 67",
    });
  });

  it("insists on a competency, a language and a region", () => {
    expect(firstIssue(schema.safeParse({ ...valid, competencies: [] }))).toBe(
      "competenciesRequired",
    );
    expect(firstIssue(schema.safeParse({ ...valid, languages: [] }))).toBe("languagesRequired");
    expect(firstIssue(schema.safeParse({ ...valid, regions: [] }))).toBe("regionsRequired");
  });

  it("allows industries and standards to be empty, because an expert may cover none by code", () => {
    expect(schema.safeParse({ ...valid, industries: [], standards: [] }).success).toBe(true);
  });

  it("refuses an available_from before today but accepts today itself", () => {
    expect(firstIssue(schema.safeParse({ ...valid, availableFrom: "2026-09-07" }))).toBe(
      "availableFromPast",
    );
    expect(schema.safeParse({ ...valid, availableFrom: TODAY }).success).toBe(true);
    expect(firstIssue(schema.safeParse({ ...valid, availableFrom: "01.12.2026" }))).toBe(
      "availableFromInvalid",
    );
  });

  it("is a factory so that today is read per parse, not frozen at import", () => {
    // The bug the factory prevents: a module level schema built at import time keeps rejecting
    // dates that became valid once the server clock rolled over.
    expect(
      expertProfileSchema("2026-09-09").safeParse({ ...valid, availableFrom: TODAY }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...valid, availableFrom: TODAY }).success).toBe(true);
  });

  it("takes a years count only as a whole number in range", () => {
    expect(schema.parse({ ...valid, yearsExperience: "0" }).yearsExperience).toBe(0);
    expect(schema.parse({ ...valid, yearsExperience: "60" }).yearsExperience).toBe(60);
    expect(firstIssue(schema.safeParse({ ...valid, yearsExperience: "61" }))).toBe(
      "yearsExperienceRange",
    );
    expect(firstIssue(schema.safeParse({ ...valid, yearsExperience: "-1" }))).toBe(
      "yearsExperienceRange",
    );
    expect(firstIssue(schema.safeParse({ ...valid, yearsExperience: "12.5" }))).toBe(
      "yearsExperienceInvalid",
    );
    expect(firstIssue(schema.safeParse({ ...valid, yearsExperience: "many" }))).toBe(
      "yearsExperienceInvalid",
    );
  });

  it("takes a phone number as people write one, and refuses letters", () => {
    expect(schema.safeParse({ ...valid, phone: "044 123 45 67" }).success).toBe(true);
    expect(schema.safeParse({ ...valid, phone: "+41(0)44/123-45-67" }).success).toBe(true);
    expect(firstIssue(schema.safeParse({ ...valid, phone: "call me" }))).toBe("phoneInvalid");
    expect(firstIssue(schema.safeParse({ ...valid, phone: "1".repeat(31) }))).toBe("phoneLong");
  });

  it("caps the bio and the availability note", () => {
    expect(firstIssue(schema.safeParse({ ...valid, bio: "b".repeat(801) }))).toBe("bioLong");
    expect(firstIssue(schema.safeParse({ ...valid, availabilityNote: "n".repeat(301) }))).toBe(
      "availabilityNoteLong",
    );
  });

  it("leaves expertId optional, because only an ops caller sends one", () => {
    expect(schema.parse(valid).expertId).toBeUndefined();
    expect(schema.parse({ ...valid, expertId: UUID }).expertId).toBe(UUID);
    expect(schema.safeParse({ ...valid, expertId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("today in Zurich", () => {
  it("reads the Swiss date, not the UTC one", () => {
    // 22:30 UTC is already the next day in Zurich (CEST, +02:00). An expert setting a date that
    // evening must not be told it is in the past.
    expect(todayInZurich(new Date("2026-09-08T22:30:00Z"))).toBe("2026-09-09");
    expect(todayInZurich(new Date("2026-09-08T09:00:00Z"))).toBe("2026-09-08");
  });

  it("answers the ISO shape the schema compares as a string", () => {
    expect(todayInZurich(new Date("2026-01-05T12:00:00Z"))).toBe("2026-01-05");
    expect(todayInZurich()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
