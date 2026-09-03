import "server-only";

import { PostHog } from "posthog-node";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";

type ServerEvent = {
  distinctId: string;
  event: string;
  properties?: Record<string, string | number | boolean | null>;
};

/**
 * Server side capture for the core funnel (spec 0001): does not depend on cookie consent because
 * it never touches the browser. One short lived client per call keeps serverless functions clean.
 * Returns false when PostHog is not configured (local development).
 */
export async function captureServerEvent(event: ServerEvent): Promise<boolean> {
  const env = serverEnv();
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) {
    log.warn("PostHog disabled: NEXT_PUBLIC_POSTHOG_KEY is not set", { event: event.event });
    return false;
  }

  const posthog = new PostHog(env.NEXT_PUBLIC_POSTHOG_KEY, {
    host: env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
  posthog.capture({
    distinctId: event.distinctId,
    event: event.event,
    properties: { ...event.properties, $lib_context: "server" },
  });
  await posthog.shutdown();
  return true;
}
