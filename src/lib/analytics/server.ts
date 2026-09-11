import "server-only";

import { PostHog } from "posthog-node";
import {
  type AnalyticsEvent,
  type AnalyticsProperties,
  propertySchema,
} from "@/lib/analytics/catalogue";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * One capture, typed by its event (spec 0017, AC-1, AC-2): the name comes from `ANALYTICS_EVENTS`,
 * so a free string is a typecheck failure, and the properties are the ones that event's schema
 * declares.
 */
type ServerEvent<E extends AnalyticsEvent> = {
  distinctId: string;
  event: E;
  properties: AnalyticsProperties<E>;
};

/**
 * Server side capture for the core funnel (spec 0001, spec 0017): does not depend on cookie
 * consent because it never touches the browser. One short lived client per call keeps serverless
 * functions clean; a reused module level client buffers in memory, and a Vercel function can
 * freeze between invocations, losing exactly the events that matter when traffic is bursty.
 *
 * Never throws and never blocks the caller (AC-8): a call site fires its event after its own work
 * has succeeded, and an analytics failure never changes a server action's typed result. Returns
 * false when PostHog is not configured (local development), when the properties fail their
 * schema, or when the send itself fails; each is logged with the event name.
 *
 * Server actions, route handlers and tasks.
 */
export async function captureServerEvent<E extends AnalyticsEvent>(
  event: ServerEvent<E>,
): Promise<boolean> {
  const parsed = propertySchema(event.event).safeParse(event.properties);
  if (!parsed.success) {
    // Dropping is the right failure for analytics: a missing event shows as a gap, while a wrong
    // event is believed (AC-2).
    log.warn("analytics event dropped: properties failed their schema", {
      event: event.event,
      issues: parsed.error.issues.map((issue) => issue.path.join(".")).join(","),
    });
    return false;
  }

  const env = serverEnv();
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    log.warn("PostHog disabled: NEXT_PUBLIC_POSTHOG_KEY is not set", { event: event.event });
    return false;
  }

  try {
    const posthog = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
      host: env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1,
      flushInterval: 0,
    });
    posthog.capture({
      distinctId: event.distinctId,
      event: event.event,
      properties: { ...parsed.data, $lib_context: "server" },
    });
    await posthog.shutdown();
    return true;
  } catch (cause) {
    log.warn("analytics event not captured", { event: event.event, reason: String(cause) });
    return false;
  }
}
