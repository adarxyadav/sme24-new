"use client";

import { useEffect, useRef } from "react";
import type { LocaleCode } from "@/i18n/routing";
import { captureBrowserEvent } from "@/lib/analytics/client";

export type DirectorySearchedProps = {
  readonly resultCount: number;
  readonly hasQuery: boolean;
  readonly hasTitle: boolean;
  readonly hasCountry: boolean;
  readonly page: number;
  readonly locale: LocaleCode;
};

/**
 * Fires `directory.searched` once per search page a person actually looked at (spec 0018,
 * AC-14): a fresh submit and each "Load more" are full navigations, and the page keys this child
 * on the search and the page ordinal, so it mounts once per result set. Never the server read,
 * which also happens on a refresh, a back navigation and a bot (the `benchmark.viewed` rule in
 * `docs/analytics.md`), and only behind the consent gate: `captureBrowserEvent` sends nothing
 * until PostHog is initialised against a current `granted` answer, so this event undercounts by
 * the rejection rate and is never compared against the server steps around it.
 *
 * Carries the shape of the search, never its text: which filters were set and how many rows came
 * back. Renders nothing; the ref guard makes it once per mount rather than once per effect run.
 * Browser only.
 */
export function DirectorySearched({
  resultCount,
  hasQuery,
  hasTitle,
  hasCountry,
  page,
  locale,
}: DirectorySearchedProps) {
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    captureBrowserEvent("directory.searched", {
      locale,
      resultCount,
      hasQuery,
      hasCountry,
      hasTitle,
      page,
    });
  }, [locale, resultCount, hasQuery, hasCountry, hasTitle, page]);

  return null;
}
