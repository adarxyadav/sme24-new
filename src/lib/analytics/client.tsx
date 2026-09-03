"use client";

import { useEffect } from "react";
import { clientEnv } from "@/lib/env";

/** Cookie the consent banner (feature 14) sets when the visitor allows analytics. */
export const ANALYTICS_CONSENT_COOKIE = "analytics_consent";

function hasAnalyticsConsent() {
  return document.cookie
    .split(";")
    .some((part) => part.trim() === `${ANALYTICS_CONSENT_COOKIE}=granted`);
}

/**
 * Consent aware browser analytics (spec 0001): posthog-js loads only after consent, and only
 * when a key is configured. Server side funnel events do not go through here.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const env = clientEnv();
    if (!env.NEXT_PUBLIC_POSTHOG_KEY || !hasAnalyticsConsent()) return;

    let cancelled = false;
    import("posthog-js").then(({ default: posthog }) => {
      if (cancelled || posthog.__loaded) return;
      posthog.init(env.NEXT_PUBLIC_POSTHOG_KEY as string, {
        api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
        persistence: "localStorage+cookie",
        capture_pageview: true,
        capture_pageleave: true,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return children;
}
