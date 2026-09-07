"use client";

import { useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useId, useMemo, useState } from "react";
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
 * `useDeferredValue` keeps typing responsive while the rows re-filter. Browser.
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
  useEffect(() => setMounted(true), []);
  const deferred = useDeferredValue(filters);

  const matches = useMemo(() => filterRegister(REGISTER, deferred), [deferred]);
  const visible = matches.slice(0, shown);
  const active = deferred.query !== "" || deferred.canton !== "" || deferred.capacity !== "";

  function update(next: Partial<RegisterFilters>) {
    setFilters((current) => ({ ...current, ...next }));
    setShown(PAGE_SIZE);
  }

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
            className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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
            className="h-10 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
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

      <p aria-live="polite" className="min-h-5 text-muted-foreground text-sm">
        {mounted ? t("count", { shown: visible.length, total: matches.length }) : null}
      </p>

      {matches.length === 0 ? (
        <p className="border-t py-12 text-center text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto border">
            <Table density="compact">
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
                  <TableRow key={`${entry[0]}-${entry[1]}-${entry[2]}`}>
                    <TableCell className="font-medium">{entry[0]}</TableCell>
                    <TableCell className="text-muted-foreground">
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
