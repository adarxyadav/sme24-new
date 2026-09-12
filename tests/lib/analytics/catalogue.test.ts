import { describe, expect, it } from "vitest";
import {
  ANALYTICS_EVENTS,
  ANALYTICS_PROPERTIES,
  type AnalyticsEvent,
  propertySchema,
} from "@/lib/analytics/catalogue";

/**
 * The analytics vocabulary's own consistency (spec 0017, AC-1, AC-2, AC-3, AC-12). The `satisfies`
 * check in the catalogue proves every name has a schema at compile time; this suite proves the
 * properties a typecheck cannot see: that the names obey the convention, that every schema demands
 * `locale`, and that the events fired by a signed in person demand `organizationId` while the
 * events that can precede an account refuse to invent one.
 *
 * The point is that the funnel is only readable if the vocabulary is uniform. A name spelled
 * `enquiry_sent` beside `benchmark.viewed` is exactly the drift this spec cleaned up, and a schema
 * that forgets `locale` silently removes a German pilot client from the language breakdown.
 */

/** `object.verb_past`: a lowercase object, one dot, a lowercase snake_case verb. */
const NAME_PATTERN = /^[a-z]+\.[a-z]+(_[a-z]+)*$/;

/**
 * The events that can only be fired by a signed in person, so their schema must demand an
 * organization. Listed here rather than derived from the schemas, because deriving the expectation
 * from the thing under test would assert nothing.
 */
const ORGANIZATION_EVENTS: readonly AnalyticsEvent[] = [
  "lookup.started",
  "research.finished",
  "benchmark.computed",
  "benchmark.viewed",
  "kpi.client_saved",
  "kpi.client_cleared",
  "checkout.started",
  "payment.completed",
  "expert.assigned",
  // Spec 0019, AC-12: the assigned expert works for a client organization.
  "assessment.started",
  "assessment.submitted",
];

/**
 * The events that can happen before an account exists, or for a person who belongs to no
 * organization. Declaring no `organizationId` is what stops a call site inventing a placeholder
 * (AC-3): an anonymous enquirer and an expert genuinely have none.
 */
const ANONYMOUS_EVENTS: readonly AnalyticsEvent[] = [
  "enquiry.sent",
  "expert.profile_completed",
  // Spec 0018, AC-14: an expert belongs to no organization, so the directory's three events
  // declare none and the credit funnel is keyed on the person alone.
  "directory.searched",
  "directory.unlocked",
  "directory.credits_purchased",
  "scaffold.test_event",
];

/**
 * A payload every schema rejects, to read which keys a schema insists on. Every issue path counts,
 * with no filter on the issue code: Zod reports an absent `z.uuid()` as `invalid_type` but an
 * absent `z.enum([...])` as `invalid_value` (verified against Zod 4.5.4), so filtering by code
 * would silently hide exactly the `locale` field this suite exists to demand.
 */
function missingKeys(event: AnalyticsEvent): readonly string[] {
  const parsed = propertySchema(event).safeParse({});
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => issue.path.join("."));
}

describe("ANALYTICS_EVENTS (AC-1, AC-12)", () => {
  it("names every event as object.verb_past with a dot", () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(event, event).toMatch(NAME_PATTERN);
    }
  });

  it("has no duplicate names", () => {
    expect(new Set(ANALYTICS_EVENTS).size).toBe(ANALYTICS_EVENTS.length);
  });

  it("has a schema for every name and no schema without a name", () => {
    // The `satisfies` check in the catalogue makes the first half a typecheck failure; this keeps
    // it true at runtime too, and catches the reverse, an orphan schema left by a deleted event.
    expect(Object.keys(ANALYTICS_PROPERTIES).sort()).toEqual([...ANALYTICS_EVENTS].sort());
  });

  it("accounts for every event in exactly one of the two organization groups", () => {
    // A new event added to the catalogue without a decision about whether it carries an
    // organization fails here, which is the moment to make that decision rather than later.
    const grouped = [...ORGANIZATION_EVENTS, ...ANONYMOUS_EVENTS].sort();
    expect(grouped).toEqual([...ANALYTICS_EVENTS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe("the property schemas (AC-2, AC-3, AC-12)", () => {
  it("requires locale on every event, so the language breakdown is never partial", () => {
    for (const event of ANALYTICS_EVENTS) {
      expect(missingKeys(event), event).toContain("locale");
    }
  });

  it("accepts only the two short language codes, never a full locale tag", () => {
    // `docs/localization.md`: the database and the URL use `de` and `en`. A call site holding a
    // `Locale` maps it through `LOCALE_CODE`; passing `de-CH` must be a drop, not a third value.
    for (const event of ANALYTICS_EVENTS) {
      const schema = propertySchema(event);
      const withLocale = (locale: string) =>
        schema.safeParse({ locale }).error?.issues.some((issue) => issue.path[0] === "locale") ??
        false;
      expect(withLocale("de"), event).toBe(false);
      expect(withLocale("en"), event).toBe(false);
      expect(withLocale("de-CH"), event).toBe(true);
      expect(withLocale("fr"), event).toBe(true);
    }
  });

  it("requires organizationId on every event fired by a signed in person", () => {
    for (const event of ORGANIZATION_EVENTS) {
      expect(missingKeys(event), event).toContain("organizationId");
    }
  });

  it("declares no organizationId on the events that can precede an account", () => {
    // Not merely optional: absent. An optional field is an invitation to pass a placeholder, and a
    // placeholder organization in the funnel is worse than no organization at all.
    for (const event of ANONYMOUS_EVENTS) {
      expect(Object.keys(propertySchema(event).shape), event).not.toContain("organizationId");
    }
  });

  it("rejects an unknown property rather than letting a typo reach PostHog", () => {
    const parsed = propertySchema("enquiry.sent").safeParse({
      locale: "en",
      topic: "retainer",
      // A property no schema declares: PostHog would accept it and create a column nobody meant.
      emailAddress: "clara@example.test",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data).not.toHaveProperty("emailAddress");
  });
});
