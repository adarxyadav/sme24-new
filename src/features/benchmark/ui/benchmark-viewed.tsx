"use client";

import { useEffect, useRef } from "react";
import type { LocaleCode } from "@/i18n/routing";
import { captureBrowserEvent } from "@/lib/analytics/client";

export type BenchmarkViewedProps = {
  readonly organizationId: string;
  readonly companyId: string;
  readonly snapshotId: string;
  readonly locale: LocaleCode;
};

/**
 * Fires `benchmark.viewed` once per dashboard visit that shows a snapshot (spec 0017, AC-6).
 *
 * `BenchmarkSegment` is a server component and a server render is not a human view: it also
 * happens on a prefetch, a refresh and a bot. So the count that means "a person looked at their
 * benchmark" can only be taken in the browser, on mount, and only behind the consent gate —
 * `captureBrowserEvent` sends nothing unless `AnalyticsProvider` has already initialised PostHog
 * against a current `granted` answer. This event is therefore absent by design for a visitor who
 * denied consent, and undercounts the server side funnel steps around it by the rejection rate.
 *
 * Renders nothing. The ref guard makes it once per mount rather than once per effect run, so
 * React's development double invoke and any re-render from a parent cannot double count.
 *
 * Browser only.
 */
export function BenchmarkViewed({
  organizationId,
  companyId,
  snapshotId,
  locale,
}: BenchmarkViewedProps) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    captureBrowserEvent("benchmark.viewed", {
      organizationId,
      companyId,
      snapshotId,
      locale,
    });
  }, [organizationId, companyId, snapshotId, locale]);

  return null;
}
