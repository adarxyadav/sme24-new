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
  filterRegister,
  LEVELS,
  type Level,
  locationCounts,
  NO_FILTERS,
  REGISTER,
  type RegisterFilters,
  type StoredLevel,
} from "@/features/marketing/register";

/** How many rows render before the reader asks for more: enough to fill a screen, cheap to paint. */
const PAGE_SIZE = 50;

/** How long the URL waits behind the last keystroke, so typing writes one history entry, not one per letter. */
const URL_DEBOUNCE_MS = 300;

/** The query parameter that carries each filter, so the names are written once and read once. */
const PARAM = { query: "query", location: "location", level: "level" } as const;

/**
 * The shared classes of the two native selects. `bg-background text-foreground` is explicit rather
 * than inherited: a `bg-transparent` select renders its popup list white on white in Windows dark
 * mode, where the list is painted by the platform and inherits nothing from the page. The options
 * carry the same pair for the same reason. The focus ring is the `Input` primitive's, unchanged.
 */
const SELECT_CLASS =
  "h-10 w-full rounded-lg border border-input bg-background px-2.5 text-foreground text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 [&>option]:bg-background [&>option]:text-foreground";

/** The locations the directory actually publishes, so a bogus `?location=` in a link is dropped. */
const LOCATION_NAMES: ReadonlySet<string> = new Set(
  locationCounts(REGISTER).map((entry) => entry.location),
);

/**
 * The filters a query string carries, with anything unknown dropped. Reading is deliberately
 * forgiving: a hand edited or stale link should narrow what it can and ignore the rest rather
 * than show an error. Pure.
 */
export function filtersFromSearch(search: string): RegisterFilters {
  const params = new URLSearchParams(search);
  const location = params.get(PARAM.location) ?? "";
  const level = params.get(PARAM.level) ?? "";
  return {
    query: params.get(PARAM.query) ?? "",
    location: LOCATION_NAMES.has(location) ? location : "",
    level: (LEVELS as readonly string[]).includes(level) ? level : "",
  };
}

/**
 * The query string a filter set deep links to, empty filters omitted entirely so an unfiltered
 * view stays a bare URL rather than `?query=&location=`. Leading `?` included, or "" for none. Pure.
 */
export function searchFromFilters(filters: RegisterFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim() !== "") params.set(PARAM.query, filters.query.trim());
  if (filters.location !== "") params.set(PARAM.location, filters.location);
  if (filters.level !== "") params.set(PARAM.level, filters.level);
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

/** The badge variant that carries each competency level, so the colour never stands alone. */
const LEVEL_VARIANT: Readonly<Record<Level, "success" | "secondary">> = {
  sme: "success",
  practitioner: "secondary",
};

/**
 * One competency cell. An entry whose source records no level renders an em dash rather than an
 * empty cell: the SGAS half of the directory has no PSM or MOC rating at all, and a blank cell
 * reads as missing data where a dash reads as not applicable. The dash carries an `sr-only` word
 * so the column is not announced as silence.
 */
function LevelCell({ level, absent }: { readonly level: StoredLevel; readonly absent: string }) {
  if (level === "") {
    return (
      <TableCell className="text-muted-foreground">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{absent}</span>
      </TableCell>
    );
  }
  return (
    <TableCell>
      <Badge variant={LEVEL_VARIANT[level]}>{level === "sme" ? "SME" : "Practitioner"}</Badge>
    </TableCell>
  );
}

/**
 * The searchable directory (spec 0009 follow-up): a name and location search, a location filter
 * and a competency filter over the published entries, with the matches in a table that grows
 * fifty rows at a time. The rows are imported rather than passed as props on purpose: a prop
 * would be serialized into the hydration payload as well as the markup, shipping all of them
 * twice, while the import puts them in one cacheable chunk. Filtering is then a pure function
 * over an array already in memory, so there is no request per keystroke, and `useDeferredValue`
 * keeps typing responsive while the rows re-filter.
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
  const locationId = useId();
  const levelId = useId();
  const locations = useMemo(() => locationCounts(REGISTER), []);
  const [filters, setFilters] = useState<RegisterFilters>(NO_FILTERS);
  const [shown, setShown] = useState(PAGE_SIZE);
  // The count is formatted with a grouping separator whose character differs between the Node
  // build and the browser's ICU (`2'075` against `2’075`), which fails hydration and leaves the
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
  const active = deferred.query !== "" || deferred.location !== "" || deferred.level !== "";

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
          <Label htmlFor={locationId}>{t("location.label")}</Label>
          {/* A native select: one control, no popover bundle, and the same keyboard behaviour on every device. */}
          <select
            id={locationId}
            className={SELECT_CLASS}
            value={filters.location}
            onChange={(event) => update({ location: event.target.value })}
          >
            <option value="">{t("location.all")}</option>
            {locations.map((entry) => (
              <option key={entry.location} value={entry.location}>
                {/*
                  Plain digits, not a formatted number: the grouping separator differs between the
                  Node build and the browser's ICU, and a mismatch here would fail hydration the
                  way the count paragraph did. No location reaches four digits, so nothing is lost.
                */}
                {`${entry.location} (${entry.count})`}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={levelId}>{t("level.label")}</Label>
          <select
            id={levelId}
            className={SELECT_CLASS}
            value={filters.level}
            onChange={(event) => update({ level: event.target.value })}
          >
            <option value="">{t("level.all")}</option>
            <option value="sme">{t("level.sme")}</option>
            <option value="practitioner">{t("level.practitioner")}</option>
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
        {mounted ? t("count", { shown: visible.length, total: matches.length }) : " "}
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
                  <TableHead>{t("columns.location")}</TableHead>
                  <TableHead>{t("columns.psm")}</TableHead>
                  <TableHead>{t("columns.moc")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((entry, index) => (
                  <TableRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: two rows can be byte identical now that names are given names only -- two people called Andreas in Switzerland carry the same four values -- so no key derived from the content is unique. The rows are a stable prefix slice of one sorted array with no insertion, reordering or per row state, so the index is the identity.
                    key={`${entry[0]}-${entry[1]}-${index}`}
                    // Rows below the fold are laid out but not painted until they scroll near, and
                    // the intrinsic size keeps the scrollbar honest while they are skipped. Fifty
                    // rows grow to hundreds as the reader asks for more, so this is worth having.
                    className="[content-visibility:auto] [contain-intrinsic-size:auto_2.5rem]"
                  >
                    {/*
                      The cell default is `whitespace-nowrap`, which a long location like
                      "Australia / New Zealand" would turn into a table wider than the viewport.
                      These two columns wrap instead and are capped, so the two badge columns
                      after them keep their place.
                    */}
                    <TableCell className="max-w-[18rem] break-words font-medium whitespace-normal">
                      {entry[0]}
                    </TableCell>
                    <TableCell className="max-w-[14rem] break-words whitespace-normal text-muted-foreground">
                      {entry[1] === "" ? t("notGiven") : entry[1]}
                    </TableCell>
                    <LevelCell level={entry[2]} absent={t("level.none")} />
                    <LevelCell level={entry[3]} absent={t("level.none")} />
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
