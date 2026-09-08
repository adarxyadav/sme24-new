"use client";

import { useEffect } from "react";
import { analyticsAllowed } from "@/features/legal/consent";
import { useConsent } from "@/features/legal/consent-store";
import { publicEnv } from "@/lib/env.public";

/**
 * The one analytics gate (spec 0001, spec 0015 AC-1, AC-3, AC-4). Nothing else in the app may
 * call `posthog.init`: PostHog loads only when a key is configured and the current consent cookie
 * says `granted`, and an answer stamped with an old `CONSENT_VERSION` counts as no answer.
 *
 * The gate watches the consent store rather than reading the cookie once, so pressing accept
 * loads PostHog in the same tab and withdrawing stops collection immediately: the effect resets
 * `posthog`, which clears its cookies and its `localStorage` keys, and no further event is sent
 * without a new acceptance. Server side funnel events do not go through here.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const consent = useConsent();
  const allowed = analyticsAllowed(consent);

  useEffect(() => {
    const env = publicEnv();
    const key = env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    if (!allowed) {
      // Withdrawal (AC-4): stop sending, then drop the distinct id, the cookies and the storage
      // keys. `reset` is safe on a library that never loaded, so a visitor who rejects from the
      // start costs one no-op import of an already bundled module.
      let cancelledOnDeny = false;
      import("posthog-js").then(({ default: posthog }) => {
        if (cancelledOnDeny || !posthog.__loaded) return;
        posthog.opt_out_capturing();
        posthog.reset(true);
      });
      return () => {
        cancelledOnDeny = true;
      };
    }

    let cancelled = false;
    import("posthog-js").then(({ default: posthog }) => {
      if (cancelled) return;
      if (posthog.__loaded) {
        // Re-accepting after a withdrawal in the same tab: the library is still in memory.
        posthog.opt_in_capturing();
        return;
      }
      posthog.init(key, {
        api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
        persistence: "localStorage+cookie",
        capture_pageview: true,
        capture_pageleave: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  return children;
}
