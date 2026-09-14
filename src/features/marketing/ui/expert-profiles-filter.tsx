"use client";

import { useEffect, useState } from "react";
import { COMPETENCY_CODES, type CompetencyCode } from "@/features/experts/catalogue";
import { cn } from "@/lib/utils";

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
 * A group of `aria-pressed` toggle buttons, not `Tabs`. Radix's tablist was the first shape here,
 * for its roving tabindex and arrow keys, but a `role="tab"` carries an `aria-controls` pointing at
 * the `TabsContent` it opens, and this filter has no panel to open: the grid it narrows is a server
 * rendered sibling that must stay outside any client component. Radix therefore emitted
 * `aria-controls` for panels that were never rendered, which axe fails as `aria-valid-attr-value`
 * and which is a real defect -- a screen reader is told each tab opens a region that does not
 * exist. A pressed button says what this actually is: a control that changes what the page shows,
 * with no panel of its own.
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

  const options: readonly (readonly [FilterValue, string])[] = [
    [ALL, allLabel],
    ...COMPETENCY_CODES.map((code) => [code, competencyLabels[code]] as const),
  ];

  return (
    /*
      The group scrolls rather than wraps below `sm`: four chips at the German labels' width turn
      into two ragged rows on a phone, and a row that scrolls reads as one control where two rows
      read as two. `-mx-4 px-4` lets it bleed to the page gutter so the last chip is visibly cut
      rather than ending flush, which is what tells a reader there is more.

      A `fieldset` with an `sr-only` `legend`, not a `div` with `role="group"`: the semantic element
      carries the grouping natively, which is what Biome's `useSemanticElements` asks for and what a
      screen reader announces without any ARIA. Not `toolbar`, which would promise arrow key
      navigation between the controls; these are plain buttons and Tab reaches each one, which is
      the behaviour a group announces.

      `min-w-0` because a `fieldset` has a `min-width: min-content` default that a plain `div` does
      not, and without it the flex row refuses to scroll and pushes the card grid wide instead.
    */
    <fieldset className="-mx-4 mb-8 flex min-w-0 max-w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0">
      <legend className="sr-only">{label}</legend>
      {options.map(([option, optionLabel]) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            // The state a pressed toggle carries. `aria-controls` names the grid this narrows,
            // which is a region that genuinely exists -- unlike the panel Radix's tablist implied.
            aria-pressed={active}
            aria-controls={controls}
            onClick={() => setValue(option)}
            className={cn(
              // Smaller than the chips shipped at: this row narrows six example cards, so it is a
              // secondary control and was competing with the cards it filters. `text-label-12` is
              // the scale's own single line size at 12px, and the label family is right because a
              // chip never wraps. The padding does not shrink with the type -- `px-2.5 py-1` keeps
              // the box wider than its text, so the chip stays a thumb-sized target and the row
              // stays one scrollable line on a phone where four German labels would wrap.
              //
              // The size is `text-[0.75rem]` rather than `text-label-12`, and the arbitrary value
              // is load bearing: `cn` is tailwind-merge, which treats `text-label-12` and the
              // `text-background` / `text-muted-foreground` below as the same `text-*` group and
              // keeps only the last, so the size class was being dropped from the class list
              // entirely. The chips had therefore always rendered at the inherited 16px -- the
              // `text-copy-13` they shipped with never applied either. Arbitrary values sit in
              // their own group and survive the merge.
              //
              // Only the size is set here; the label family's leading, tracking and weight are the
              // three lines under it, so the chip still takes its metrics from the scale rather
              // than from a bare font-size.
              "shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 transition-colors",
              "text-[0.75rem] leading-[1.33] tracking-[0.004em] font-normal",
              "focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {optionLabel}
          </button>
        );
      })}
    </fieldset>
  );
}
