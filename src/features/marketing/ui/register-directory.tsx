"use client";

import { useTranslations } from "next-intl";
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CAPACITIES,
  type Capacity,
  cantonCounts,
  filterRegister,
  NO_FILTERS,
  REGISTER,
  type RegisterFilters,
  type Status,
} from "@/features/marketing/register";

/** How many rows render before the reader asks for more: enough to fill a screen, cheap to paint. */
const PAGE_SIZE = 50;

/** How long the URL waits behind the last keystroke, so typing writes one history entry, not one per letter. */
const URL_DEBOUNCE_MS = 300;

/** The query parameter that carries each filter, so the names are written once and read once. */
const PARAM = { query: "query", canton: "canton", capacity: "capacity" } as const;

/**
 * The shared classes of the two native selects. `bg-background text-foreground` is explicit rather
 * than inherited: a `bg-transparent` select renders its popup list white on white in Windows dark
 * mode, where the list is painted by the platform and inherits nothing from the page. The options
 * carry the same pair for the same reason. The focus ring is the `Input` primitive's, unchanged.
 */
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-foreground text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-background [&>option]:text-foreground";

/** The canton codes the register actually publishes, so a bogus `?canton=` in a link is dropped. */
const CANTON_CODES: ReadonlySet<string> = new Set(
  cantonCounts(REGISTER).map((entry) => entry.canton),
);

/**
 * The filters a query string carries, with anything unknown dropped. Reading is deliberately
 * forgiving: a hand edited or stale link should narrow what it can and ignore the rest rather
 * than show an error. Pure.
 */
export function filtersFromSearch(search: string): RegisterFilters {
  const params = new URLSearchParams(search);
  const canton = params.get(PARAM.canton) ?? "";
  const capacity = params.get(PARAM.capacity) ?? "";
  return {
    query: params.get(PARAM.query) ?? "",
    canton: CANTON_CODES.has(canton) ? canton : "",
    capacity: (CAPACITIES as readonly string[]).includes(capacity) ? capacity : "",
  };
}

/**
 * The query string a filter set deep links to, empty filters omitted entirely so an unfiltered
 * view stays a bare URL rather than `?query=&canton=`. Leading `?` included, or "" for none. Pure.
 */
export function searchFromFilters(filters: RegisterFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim() !== "") params.set(PARAM.query, filters.query.trim());
  if (filters.canton !== "") params.set(PARAM.canton, filters.canton);
  if (filters.capacity !== "") params.set(PARAM.capacity, filters.capacity);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** The badge variant that carries each capacity, so the colour never stands alone. */
const CAPACITY_VARIANT: Readonly<
  Record<Capacity, "success" | "warning" | "outline" | "secondary">
> = {
  v: "success",
  t: "warning",
  n: "outline",
  u: "secondary",
};

/** The badge variant of a continuing-education status. */
const STATUS_VARIANT: Readonly<Record<Status, "success" | "warning" | "outline" | "secondary">> = {
  A: "success",
  T: "warning",
  N: "outline",
  E: "secondary",
  U: "secondary",
};

/**
 * The searchable register (spec 0009 follow-up, expert directory): a name and town search, a
 * canton filter and a capacity filter over the published register, with the matches in a table
 * that grows fifty rows at a time. The rows are imported rather than passed as props on purpose:
 * a prop would be serialized into the hydration payload as well as the markup, shipping all 1,929
 * of them twice, while the import puts them in one cacheable chunk. Filtering is then a pure
 * function over an array already in memory, so there is no request per keystroke, and
 * `useDeferredValue` keeps typing responsive while the rows re-filter.
 *
 * The three filters are mirrored into the query string so a narrowed view is shareable, and that
 * mirror is one way and browser only: the state is read from `window.location` after mount and
 * written back with `history.replaceState`, which Next integrates with its router. Neither
 * `useSearchParams` nor the `next-intl` router appears here on purpose. This page is prerendered,
 * so `useSearchParams` would need a `Suspense` boundary in the server page, and the page is not
 * this component's to edit; `replaceState` needs none and keeps the page static. Browser.
 */
export function RegisterDirectory() {
  const t = useTranslations("marketing.directory");
  const searchId = useId();
  const cantonId = useId();
  const capacityId = useId();
  const cantons = useMemo(() => cantonCounts(REGISTER), []);
  const [filters, setFilters] = useState<RegisterFilters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE_SIZE);
  // The count is formatted with a grouping separator whose character differs between the Node
  // build and the browser's ICU (`1'929` against `1’929`), which fails hydration and leaves the
  // whole component inert. It carries nothing before the first interaction, so it is rendered
  // after mount only, where server and client can no longer disagree.
  const [mounted, setMounted] = useState(false);
  // The same mount that releases the count adopts the filters the URL arrived with, so a shared
  // link opens narrowed. It cannot run during render: the server renders `NO_FILTERS`, and any
  // filter read before hydration would make the markup disagree with itself the way the count did.
  useEffect(() => {
    setMounted(true);
    const fromUrl = filtersFromSearch(window.location.search);
    if (searchFromFilters(fromUrl) !== "") setFilters(fromUrl);
  }, []);
  const deferred = useDeferredValue(filters);

  // The URL follows the filters a beat behind. `replaceState` rather than `push`, so typing leaves
  // one entry rather than one per letter, and behind a timer, so a keystroke never waits on the
  // router. The write is skipped until mount, or the first paint would rewrite the URL it just
  // read. Nothing reads this back: it is a mirror for sharing, not the state itself.
  useEffect(() => {
    if (!mounted) return;
    const timer = window.setTimeout(() => {
      const next = `${window.location.pathname}${searchFromFilters(filters)}${window.location.hash}`;
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
        window.history.replaceState(null, "", next);
      }
    }, URL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [filters, mounted]);

  const matches = useMemo(() => filterRegister(REGISTER, deferred), [deferred]);
  const visible = matches.slice(0, shown);
  const active = deferred.query !== "" || deferred.canton !== "" || deferred.capacity !== "";

  const update = useCallback((next: Partial<RegisterFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setShown(PAGE_SIZE);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 border-t pt-6 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <div className="flex flex-col gap-2">
          <Label htmlFor={searchId}>{t("search.label")}</Label>
          <Input
            id={searchId}
            type="search"
            autoComplete="off"
            className="h-10"
            placeholder={t("search.placeholder")}
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={cantonId}>{t("canton.label")}</Label>
          {/* A native select: one control, no popover bundle, and the same keyboard behaviour on every device. */}
          <select
            id={cantonId}
            className={SELECT_CLASS}
            value={filters.canton}
            onChange={(event) => update({ canton: event.target.value })}
          >
            <option value="">{t("canton.all")}</option>
            {cantons.map((entry) => (
              <option key={entry.canton} value={entry.canton}>
                {/*
                  Plain digits, not a formatted number: the grouping separator differs between the
                  Node build and the browser's ICU, and a mismatch here would fail hydration the
                  way the count paragraph did. No canton reaches four digits, so nothing is lost.
                */}
                {`${entry.canton} (${entry.count})`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={capacityId}>{t("capacity.label")}</Label>
          <select
            id={capacityId}
            className={SELECT_CLASS}
            value={filters.capacity}
            onChange={(event) => update({ capacity: event.target.value })}
          >
            <option value="">{t("capacity.all")}</option>
            <option value="v">{t("capacity.v")}</option>
            <option value="t">{t("capacity.t")}</option>
            <option value="n">{t("capacity.n")}</option>
            <option value="u">{t("capacity.u")}</option>
          </select>
        </div>
        {active ? (
          <Button variant="outline" className="h-10" onClick={() => update(NO_FILTERS)}>
            {t("clear")}
          </Button>
        ) : null}
      </div>

      {/*
        The paragraph itself is always in the DOM so the live region exists before the first
        filter changes it; only its text waits for the mount, which is what the grouping guard
        above needs. A region that appears rather than changes is announced unreliably.
      */}
      <p aria-live="polite" className="min-h-5 text-muted-foreground text-sm">
        {mounted ? t("count", { shown: visible.length, total: matches.length }) : "\u00a0"}
      </p>

      {matches.length === 0 ? (
        <p className="border-t py-12 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto border">
            <Table aria-labelledby="register-heading" density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.place")}</TableHead>
                  <TableHead>{t("columns.canton")}</TableHead>
                  <TableHead>{t("columns.capacity")}</TableHead>
                  <TableHead>{t("columns.training")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((entry) => (
                  <TableRow
                    key={`${entry[0]}-${entry[1]}-${entry[2]}`}
                    // Rows below the fold are laid out but not painted until they scroll near, and
                    // the intrinsic size keeps the scrollbar honest while they are skipped. Fifty
                    // rows grow to hundreds as the reader asks for more, so this is worth having.
                    className="[content-visibility:auto] [contain-intrinsic-size:auto_2.5rem]"
                  >
                    {/*
                      The cell default is `whitespace-nowrap`, which a long double barrelled name
                      or an unhyphenated town would turn into a table wider than the viewport.
                      These two columns wrap instead and are capped, so the three short columns
                      after them keep their place.
                    */}
                    <TableCell className="max-w-[18rem] break-words font-medium whitespace-normal">
                      {entry[0]}
                    </TableCell>
                    <TableCell className="max-w-[14rem] break-words whitespace-normal text-muted-foreground">
                      {entry[1] === "" ? t("notGiven") : entry[1]}
                    </TableCell>
                    <TableCell className="tabular-nums" data-numeric>
                      {entry[2] === "" ? t("notGiven") : entry[2]}
                    </TableCell>
                    <TableCell>
                      <Badge variant={CAPACITY_VARIANT[entry[4]]}>
                        {t(`capacity.${entry[4]}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[entry[6]]}>{t(`status.${entry[6]}`)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {shown < matches.length ? (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((count) => count + PAGE_SIZE)}>
                {t("more", { count: Math.min(PAGE_SIZE, matches.length - shown) })}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
