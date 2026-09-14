"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COMPETENCY_CODES, type CompetencyCode } from "@/features/experts/catalogue";

/** The query parameter the active competency mirrors into, written once and read once. */
const PARAM = "competency";

/** The tab value that shows every card; not a competency, so it is spelled out here. */
const ALL = "all";

/** The filter's value: a real competency code, or `all`. */
type FilterValue = CompetencyCode | typeof ALL;

/**
 * The competency in a query string, or `all` for anything unknown or absent. Pure, runs anywhere:
 * an unrecognised value is dropped rather than trusted, so a hand edited URL cannot select a
 * competency the catalogue does not carry.
 */
function filterFromSearch(search: string): FilterValue {
  const value = new URLSearchParams(search).get(PARAM);
  return COMPETENCY_CODES.find((code) => code === value) ?? ALL;
}

export type ExpertProfilesFilterProps = {
  /**
   * The id of the grid this filters, so the tablist points at the thing it controls. The grid is
   * server rendered by `ExpertProfiles` and is not this component's child: the cards must stay in
   * the HTML for a reader without JavaScript, so the filter hides them rather than owning them.
   */
  readonly controls: string;
  /** The tablist's accessible name. */
  readonly label: string;
  /** The label of the tab that shows every card. */
  readonly allLabel: string;
  /** One label per competency, in `COMPETENCY_CODES` order, from `experts.catalogue`. */
  readonly competencyLabels: Readonly<Record<CompetencyCode, string>>;
};

/**
 * The competency filter above the example profiles (docs/design.md, marketing section vocabulary).
 * `Tabs` rather than a row of buttons: Radix gives the tablist its roving tabindex, arrow key
 * navigation and `aria-selected` for free, which is the part a hand rolled row gets wrong.
 *
 * It filters by writing the active competency to `data-competency` on the grid and letting CSS in
 * `ExpertProfiles` hide the cards that do not match, rather than by rendering the list itself.
 * That is what keeps all six cards in the prerendered HTML: a visitor without JavaScript sees the
 * whole grid and no filter, a crawler indexes six profiles, and hydration has nothing to disagree
 * with because the server and the first client paint both render the unfiltered grid.
 *
 * Every label arrives as a prop rather than through `useTranslations`. Only the shared namespaces
 * reach the browser (spec 0004, AC-6), and the two this needs do not: `experts.catalogue` carries
 * every standard, NOGA section and canton, so shipping it for four chips would put a large
 * namespace on a page with a 250 kB budget, and the alternative -- a nested `NextIntlClientProvider`
 * the way `/cookies` does it -- costs the same payload. The server has these strings already.
 *
 * The choice is mirrored into the query string one way and browser only, the shape
 * `RegisterDirectory` already uses on the sibling page: read from `window.location` after mount,
 * written back with `history.replaceState`. Neither `useSearchParams` nor the `next-intl` router
 * appears here on purpose -- this page is prerendered, so `useSearchParams` would need a
 * `Suspense` boundary in the server page, and `replaceState` needs none and keeps the page static.
 * Browser.
 */
export function ExpertProfilesFilter({
  controls,
  label,
  allLabel,
  competencyLabels,
}: ExpertProfilesFilterProps) {
  const [value, setValue] = useState<FilterValue>(ALL);
  // The control is drawn only once it can do something. Without JavaScript the tabs still render
  // and clicking one does nothing, which is worse than no filter at all: a dead control is a
  // broken page, while six unfiltered cards are simply the whole set. `mounted` is false on the
  // server and on the first client paint, so the markup matches either way and the row appears
  // with hydration.
  const [mounted, setMounted] = useState(false);

  // The filter the URL arrived with is adopted after mount, never during render: the server
  // renders the unfiltered grid, so reading it earlier would make the markup disagree with itself.
  useEffect(() => {
    setMounted(true);
    const fromUrl = filterFromSearch(window.location.search);
    if (fromUrl !== ALL) setValue(fromUrl);
  }, []);

  // The grid is a sibling rather than a child, so the selection reaches it through the DOM. This
  // is the one place a layout read is justified: the cards must be server rendered for a visitor
  // without JavaScript, which rules out rendering them from this component's state.
  useEffect(() => {
    const grid = document.getElementById(controls);
    if (grid) grid.dataset.competency = value;
  }, [controls, value]);

  // The URL follows the tabs. `replaceState` rather than `push`, so switching tabs leaves one
  // history entry rather than one per click. Nothing reads this back: it is a mirror for sharing.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (value === ALL) url.searchParams.delete(PARAM);
    else url.searchParams.set(PARAM, value);
    const next = `${url.pathname}${url.search}${url.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);
    }
  }, [value]);

  if (!mounted) return null;

  return (
    <Tabs className="mb-8" value={value} onValueChange={(next) => setValue(next as FilterValue)}>
      {/*
        The list scrolls rather than wraps below `sm`: four chips at the German labels' width turn
        into two ragged rows on a phone, and a row that scrolls reads as one control where two
        rows read as two. `-mx-4 px-4` lets it bleed to the page gutter so the last chip is
        visibly cut rather than ending flush, which is what tells a reader there is more.
      */}
      <TabsList
        aria-label={label}
        aria-controls={controls}
        className="-mx-4 w-auto max-w-[calc(100%+2rem)] justify-start overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0"
      >
        <TabsTrigger value={ALL}>{allLabel}</TabsTrigger>
        {COMPETENCY_CODES.map((code) => (
          <TabsTrigger key={code} value={code}>
            {competencyLabels[code]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
