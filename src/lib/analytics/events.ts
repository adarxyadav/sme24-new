/**
 * The analytics event names (spec 0017, AC-1), in a module that imports nothing (spec 0009,
 * AC-16). Split out of `catalogue.ts` so the browser can name an event without pulling zod into
 * a marketing first load: `catalogue.ts` imports `zod` for its per event property schemas, and
 * `AnalyticsProvider` in `client.tsx` sits in the root layout, so any value it imports from the
 * catalogue reaches every static page's shared chunk. `pnpm budget` is the gate that catches it.
 *
 * The list stays single source: `catalogue.ts` imports `AnalyticsEvent` from here and keys its
 * schemas by it, so a name added here without a schema is still a compile error there.
 *
 * Names follow `object.verb_past` with a dot. Pure data, runs anywhere.
 */
export const ANALYTICS_EVENTS = [
  "lookup.started",
  "research.finished",
  "benchmark.computed",
  "benchmark.viewed",
  "kpi.client_saved",
  "kpi.client_cleared",
  "checkout.started",
  "payment.completed",
  "enquiry.sent",
  "expert.profile_completed",
  "expert.assigned",
  "directory.searched",
  "directory.unlocked",
  "directory.credits_purchased",
  "scaffold.test_event",
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];
