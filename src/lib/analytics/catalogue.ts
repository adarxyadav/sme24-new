import { z } from "zod";
import { ANALYTICS_EVENTS, type AnalyticsEvent } from "@/lib/analytics/events";

/**
 * The analytics vocabulary (spec 0017, AC-1, AC-2, AC-3): `ANALYTICS_EVENTS` in
 * `@/lib/analytics/events` names every event the app may capture, and this module gives each one
 * the schema of the properties it must carry. Mirrors the shape of `ALERT_KINDS` and `alertFields`
 * in `src/lib/alerts/schema.ts` deliberately, so events and alerts share one mental model. Pure
 * data, runs anywhere.
 *
 * The names live in their own zod-free module so browser code can import an event name without
 * pulling the zod runtime into a marketing first load (spec 0009, AC-16); see the note there. They
 * are re-exported here so a server side caller still has one import for the whole vocabulary.
 *
 * A name that is not in the list cannot reach `captureServerEvent`, and a name without a schema
 * fails the `satisfies` check below, so the drift this spec cleans up (`enquiry_sent` beside a
 * promised `benchmark.viewed`) cannot recur.
 *
 * Events carry ids and codes, never personal content: no email address, no contact name, no
 * company name and no free text. `organizationId` and `companyId` are opaque UUIDs, useless
 * without database access. This mirrors the rule already stated for alerts.
 */
export { ANALYTICS_EVENTS, type AnalyticsEvent };

/**
 * The short language code every event carries (AC-2), matching `docs/localization.md`: the
 * database and the URL use `de` and `en`, never the full `de-CH` tag. A call site holding a
 * `Locale` maps it through `LOCALE_CODE` rather than passing the tag.
 */
const localeCode = z.enum(["de", "en"]);

/**
 * Per event property schemas (AC-2). `captureServerEvent` parses against the event's own schema
 * before sending, so a transposed `companyId`/`organizationId` pair or a value that arrived null
 * from a database row becomes a logged drop rather than a quietly wrong chart.
 *
 * Every schema requires `locale`. An event fired by a signed in person also requires
 * `organizationId`; an event that can happen before an account exists declares none, so no call
 * site is tempted to invent a placeholder (AC-3).
 */
const analyticsProperties = {
  /** `requestResearch`, after the company and run rows insert. */
  "lookup.started": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    companyId: z.uuid(),
    runId: z.uuid(),
  }),
  /** The `research-company` task, at the terminal status write. */
  "research.finished": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    runId: z.uuid(),
    status: z.string().min(1).max(50),
    kpiCount: z.number().int().nonnegative(),
    provider: z.string().min(1).max(50),
    durationMs: z.number().int().nonnegative(),
  }),
  /** The `benchmark-company` task, after the snapshot insert. */
  "benchmark.computed": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    companyId: z.uuid(),
    triggerKind: z.enum(["research", "client_edit", "recompute"]),
    kpisCompared: z.number().int().nonnegative(),
    modelVersion: z.string().min(1).max(50),
  }),
  /**
   * The one browser event (AC-6): a server render also happens on a prefetch, a refresh and a
   * bot, so a genuine human view can only be counted in the browser, behind the consent gate.
   * Its number is therefore smaller than the server side steps around it, by the consent
   * rejection rate, and must never be compared against them without saying so.
   */
  "benchmark.viewed": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    companyId: z.uuid(),
    snapshotId: z.uuid(),
  }),
  /** `saveClientKpis`, after the write. The keys present in the submission, not the keys changed. */
  "kpi.client_saved": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    companyId: z.uuid(),
    kpiKeysSent: z.number().int().nonnegative(),
    reportingYear: z.number().int(),
  }),
  /** `clearClientKpi`, after the delete. */
  "kpi.client_cleared": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    companyId: z.uuid(),
    kpiKey: z.string().min(1).max(100),
  }),
  /** `startCheckout`, after the session id write is confirmed. */
  "checkout.started": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    orderId: z.uuid(),
    packageKey: z.string().min(1).max(50),
    grossRappen: z.number().int().nonnegative(),
  }),
  /** `settleOrder`, after the settle RPC succeeds. */
  "payment.completed": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
    orderId: z.uuid(),
    packageKey: z.string().min(1).max(50),
    grossRappen: z.number().int().nonnegative(),
    invoiceNumber: z.string().min(1).max(50),
  }),
  /**
   * `submitEnquiry`, after the row insert. No `organizationId` (AC-3): the sender may be
   * anonymous, and an ops or expert tester's submission stays anonymous on the row too. The topic
   * is the code, never the message.
   */
  "enquiry.sent": z.object({
    locale: localeCode,
    topic: z.string().min(1).max(50),
  }),
  /**
   * `updateExpertProfile`, on the save that flips the status to `active`. Named
   * `expert.profile_completed` rather than `expert.onboarded` because that exact string is already
   * an `ALERT_KINDS` entry, and one name must not mean both an alert and an event (AC-7). No
   * `organizationId`: an expert belongs to none.
   */
  "expert.profile_completed": z.object({
    locale: localeCode,
  }),
  /**
   * `assignExpert`, after the assignment insert. Live in the code before this spec and absent from
   * its catalogue table, so it is catalogued here rather than left as the one untyped name; the
   * spec's follow up list records the addition. The organization is the client the expert was
   * assigned to, so it is required.
   */
  "expert.assigned": z.object({
    organizationId: z.uuid(),
    locale: localeCode,
  }),
  /**
   * The ops only `/admin` scaffold probe that proves the PostHog wiring end to end. Not a funnel
   * event; catalogued because AC-1 makes the name a closed union and a diagnostic escape hatch
   * would weaken exactly the guarantee this spec buys. Carries no organization: ops fire it for
   * themselves.
   */
  "scaffold.test_event": z.object({
    locale: localeCode,
    source: z.string().min(1).max(50),
  }),
} as const satisfies Record<AnalyticsEvent, z.ZodType>;

/** The typed properties of one event. */
export type AnalyticsProperties<E extends AnalyticsEvent> = z.infer<
  (typeof analyticsProperties)[E]
>;

/**
 * The schema for one event, for `captureServerEvent` to parse against before sending. Pure.
 */
export function propertySchema<E extends AnalyticsEvent>(
  event: E,
): (typeof analyticsProperties)[E] {
  return analyticsProperties[event];
}

/** Every event paired with its schema, for the catalogue consistency suite. Pure. */
export const ANALYTICS_PROPERTIES = analyticsProperties;
