"use client";

import { useEffect } from "react";
import { analyticsAllowed } from "@/features/legal/consent";
import { useConsent } from "@/features/legal/consent-store";
import { publicEnv } from "@/lib/env.public";

/**
 * The prefix every PostHog persisted key carries, in `localStorage` (`ph_<token>_posthog`) and in
 * a cookie (`ph_<token>_posthog`, or the opt out flag `ph_<token>_opt_out`) alike. Pure; runs
 * anywhere.
 */
const POSTHOG_STORAGE_PREFIX = "ph_";

/**
 * Every key currently in `storage`, read through the portable `length`/`key` pair rather than
 * `Object.keys`: a real browser also exposes stored keys as enumerable own properties, but the
 * `Storage` interface never promises that, and this repo's own Node 25 `localStorage` shim (see
 * `tests/setup.ts`) is a plain object backed by a private `Map`, so `Object.keys` on it returns
 * its method names, not the stored keys. `length`/`key` is what both shapes actually implement.
 * Pure given a `Storage`; runs anywhere the argument is valid.
 */
function storageKeys(storage: Storage): readonly string[] {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) keys.push(key);
  }
  return keys;
}

/**
 * Deletes every `localStorage` key and cookie PostHog has ever written, whether or not the
 * library has been initialised in this JS context (browser only).
 *
 * `posthog.reset()` and `posthog.opt_out_capturing()` both check the library's own `__loaded`
 * flag first and do nothing at all when it is false, so on a fresh page load, where withdrawal
 * happens before any `init` call in this tab, they cannot be trusted to clear what an earlier,
 * accepted session already wrote to storage. This clears that storage directly instead: honest
 * about what a never loaded instance can and cannot do, and it never calls `posthog.init`, so
 * AC-1 (nothing loads without a current acceptance) still holds.
 */
function clearPersistedPostHogState(): void {
  for (const key of storageKeys(window.localStorage)) {
    if (key.startsWith(POSTHOG_STORAGE_PREFIX)) window.localStorage.removeItem(key);
  }
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name?.startsWith(POSTHOG_STORAGE_PREFIX)) {
      // Deleting an unknown number of ph_ prefixed cookies by name, which the Cookie Store API
      // this rule prefers cannot do (no wildcard delete, and it is Chromium only); the sidebar
      // cookie write nearby is the same carve out, scoped in biome.json instead because that file
      // is a shadcn primitive rather than hand written.
      // biome-ignore lint/suspicious/noDocumentCookie: see above
      document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    }
  }
}

/**
 * The one analytics gate (spec 0001, spec 0015 AC-1, AC-3, AC-4). Nothing else in the app may
 * call `posthog.init`: PostHog loads only when a key is configured and the current consent cookie
 * says `granted`, and an answer stamped with an old `CONSENT_VERSION` counts as no answer.
 *
 * The gate watches the consent store rather than reading the cookie once, so pressing accept
 * loads PostHog in the same tab and withdrawing stops collection immediately: the effect resets
 * `posthog` when it is already in memory and always clears its persisted storage directly (see
 * `clearPersistedPostHogState`), and no further event is sent without a new acceptance. Server
 * side funnel events do not go through here.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const consent = useConsent();
  const allowed = analyticsAllowed(consent);

  useEffect(() => {
    const env = publicEnv();
    const key = env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) return;

    if (!allowed) {
      // Withdrawal (AC-4): the storage clear runs unconditionally, because a fresh page load
      // never has a loaded instance to ask. When the library is already in memory (withdrawing
      // in the same tab that accepted), stop it in place first, so it does not write anything
      // more between now and the clear below.
      let cancelledOnDeny = false;
      import("posthog-js").then(({ default: posthog }) => {
        if (cancelledOnDeny) return;
        if (posthog.__loaded) {
          posthog.opt_out_capturing();
          posthog.reset(true);
        }
        clearPersistedPostHogState();
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
