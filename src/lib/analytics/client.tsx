"use client";

import { useEffect } from "react";
import { analyticsAllowed } from "@/features/legal/consent";
import { useConsent } from "@/features/legal/consent-store";
// Types only, and they must stay that way: `catalogue.ts` imports zod, and this module is mounted
// by the root layout, so a *value* imported from it would put the zod runtime in every marketing
// page's first load and fail `pnpm budget` (spec 0009, AC-16). A `type` import erases at build, so
// the property types can still be the zod-inferred ones; the event names come from the zod-free
// `events` module. The Biome override for this file bans the value import mechanically.
import type { AnalyticsProperties } from "@/lib/analytics/catalogue";
import type { AnalyticsEvent } from "@/lib/analytics/events";
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

/**
 * The shape every property value may take: an id, a locale code, or one of the scalars the
 * catalogue's schemas allow. Pure; runs anywhere.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The property keys whose catalogue schema is `z.uuid()`. */
const UUID_KEYS = ["organizationId", "companyId", "snapshotId", "runId", "orderId"] as const;

/**
 * The browser's own check that a payload matches what its catalogue schema demands (AC-2), written
 * by hand rather than with zod because `catalogue.ts` imports zod and this module is mounted by
 * the root layout, so calling a schema here puts the zod runtime in every marketing first load
 * (spec 0009, AC-16).
 *
 * It is deliberately narrower than the schemas: it checks the invariants the one browser event
 * actually carries — every id is a UUID and `locale` is a short code — rather than restating
 * twelve schemas that would then drift from the catalogue. The server path keeps full zod parsing,
 * and `tests/lib/analytics/catalogue.test.ts` still proves the schemas themselves. The typed
 * `AnalyticsProperties<E>` parameter is what stops a wrong *shape* reaching here at all; this
 * guards the values a type cannot see, which is how a null from a database row gets dropped.
 *
 * Pure; runs anywhere.
 */
function browserPropertiesValid(properties: Readonly<Record<string, unknown>>): boolean {
  for (const key of UUID_KEYS) {
    if (!(key in properties)) continue;
    const value = properties[key];
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) return false;
  }
  if ("locale" in properties && properties.locale !== "de" && properties.locale !== "en") {
    return false;
  }
  return true;
}

/**
 * Browser side capture for the one genuine view event (spec 0017, AC-6). Typed by the same
 * catalogue as `captureServerEvent`, so a free string is a typecheck failure here too, and the
 * property values are checked against that event's invariants before sending.
 *
 * Consent gated by construction: it sends only through a `posthog-js` instance that
 * `AnalyticsProvider` has already initialised, and the gate initialises nothing without a current
 * `granted` answer. With no answer, a denied answer, or no key configured, the library is never
 * loaded, `__loaded` is false and this is a no op — it never calls `posthog.init` itself, so it
 * cannot become a second way for analytics to start.
 *
 * Never throws and never blocks the caller: a failed capture is a missing event, not a broken
 * render. Browser only.
 */
export function captureBrowserEvent<E extends AnalyticsEvent>(
  event: E,
  properties: AnalyticsProperties<E>,
): void {
  // Dropping is the right failure for analytics: a missing event shows as a gap, while a wrong
  // event is believed (AC-2). No `log` here: that module is server side, and a browser console
  // warning is the honest equivalent.
  if (!browserPropertiesValid(properties)) {
    console.warn("analytics event dropped: properties failed their schema", event);
    return;
  }

  if (!publicEnv().NEXT_PUBLIC_POSTHOG_KEY) return;

  import("posthog-js")
    .then(({ default: posthog }) => {
      // The consent check: a library that was never initialised is a visitor who has not accepted.
      if (!posthog.__loaded) return;
      posthog.capture(event, { ...properties, $lib_context: "browser" });
    })
    .catch(() => undefined);
}
