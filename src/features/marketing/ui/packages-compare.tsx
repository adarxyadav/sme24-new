import { useFormatter, useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { type Package, sortedPackages } from "@/features/marketing/packages";

type PackageMessageKey = Parameters<ReturnType<typeof useTranslations<"marketing.packages">>>[0];
type CompareMessageKey = Parameters<
  ReturnType<typeof useTranslations<"marketing.pricing.compare">>
>[0];

/**
 * The four packages as one comparison table under the package cards (client request of
 * 2026-09-14): seven rows -- best for, format, core value, scope, output, outcome, price -- with
 * one column per package in catalog order.
 *
 * Every cell but one reads the same `marketing.packages.<key>.*` keys the cards above it read, so
 * the table cannot drift from them: a copy fix to a promise or a delivery line lands in both
 * places at once. The exception is the output row, which the client's table words differently
 * from the catalog ("Top 5 risks" against "Culture level per category"); those three strings live
 * under `marketing.pricing.compare.output.*` and are the only place the two sections disagree.
 * Whether the cards adopt that wording is an open copy decision -- if they do, this override and
 * its keys go away and the row joins the rest.
 *
 * The scope row is the card's `included` points joined into one cell rather than the checked list
 * the card sets: a table cell that holds a nested list turns one row into four different heights,
 * and the points are a scope summary here rather than a contents list to read down.
 *
 * Prices come from `PACKAGES`, never from a string, and the partner's cell takes its own copy
 * because "On demand -- contact us for more information" is a sentence rather than the card's bare
 * "On demand".
 *
 * Built from the design system's `Table` primitives, which carry `"use client"`, so this renders
 * on the client even though it holds no state: consistency with every other table in the product
 * is worth the bytes, and `pnpm budget` is the gate that says whether it stays worth them.
 */
export function PackagesCompare() {
  const t = useTranslations("marketing.packages");
  const pricing = useTranslations("marketing.pricing");
  const compare = useTranslations("marketing.pricing.compare");
  const format = useFormatter();
  const packages = sortedPackages();

  /* Six of the seven rows are a label and one lookup per package, so they are data rather than
     markup: only the price row draws differently, because it formats a number and falls back to a
     sentence for the partner. */
  const rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly cell: (entry: Package) => string;
  }[] = [
    {
      key: "bestFor",
      label: pricing("bestForLabel"),
      /*
        The card's own `bestFor` is a lowercase fragment because it renders after the label as one
        sentence ("Best for: quick visibility"). A table cell is a standalone phrase under a column
        head, so it takes the capitalised form the client's table sets.
      */
      cell: (entry) => compare(`bestFor.${entry.key}` as CompareMessageKey),
    },
    {
      key: "format",
      label: compare("formatLabel"),
      cell: (entry) => t(`${entry.key}.delivery`),
    },
    {
      key: "coreValue",
      label: compare("coreValueLabel"),
      cell: (entry) => t(`${entry.key}.promise`),
    },
    {
      key: "scope",
      label: compare("scopeLabel"),
      cell: (entry) =>
        entry.included
          .map((point) => t(`${entry.key}.included.${point}` as PackageMessageKey))
          .join(" · "),
    },
    {
      key: "output",
      /*
        "You get" and "So that" are the card's labels: they work as the opening of a sentence
        beside one value and read as an instruction rather than a column head in a table. The row
        heads take the client's own nouns instead.
      */
      label: compare("outputLabel"),
      cell: (entry) => compare(`output.${entry.key}` as CompareMessageKey),
    },
    {
      key: "outcome",
      label: compare("outcomeLabel"),
      cell: (entry) => t(`${entry.key}.outcome`),
    },
  ];

  return (
    /*
      Built from the design system's `Table` primitives rather than raw markup, so the row rules,
      the hover, the scroll container and its keyboard affordance are the ones every other table in
      the product uses. `scrollLabel` is the primitive's own answer to a scrollable region holding
      nothing focusable (WCAG 2.1.1): it spreads `tabIndex`, `role` and `aria-label` together, so
      the label never lands on an element that cannot carry one.

      The table scrolls sideways under its own width rather than collapsing into four stacked
      blocks. Stacked, it would be the package cards a second time -- the same seven facts per
      package, one package at a time -- and comparing across packages is the only thing this
      section adds over the cards. The row labels stay in view while it scrolls, so a cell three
      columns in is still attributable to its row.

      `min-w-4xl` is the width below which the five columns stop being readable, not a fixed table
      width: above it the table fills its container and the scroller never engages. `table-fixed`
      with an explicit label column keeps the four package columns equal, so a long cell in one
      does not widen its column against the others -- the comparison only reads if the columns are
      comparable. The closed frame is the one the packages and trust sections draw; `border-separate`
      with no spacing lets the cells' own rules meet it without doubling.
    */
    <Table
      scrollLabel={compare("heading")}
      className="min-w-4xl table-fixed border border-separate border-spacing-0"
    >
      <colgroup>
        <col className="w-40" />
        <col className="w-1/4" />
        <col className="w-1/4" />
        <col className="w-1/4" />
        <col className="w-1/4" />
      </colgroup>
      <TableCaption className="sr-only">{compare("heading")}</TableCaption>
      <TableHeader>
        {/*
          The head row keeps the page ground rather than taking the primitive's row hover: these
          are column heads, not data the reader points at, and the sticky label cell beside them
          has to stay opaque as the columns scroll under it.
        */}
        <TableRow className="hover:bg-transparent">
          <TableHead className="sticky left-0 z-10 h-auto border-b bg-background px-4 py-4 align-top">
            {/*
              The label is top aligned with the column heads beside it rather than sitting on the
              cell's floor, so it reads against the trade names rather than against the subtitles
              under them.
            */}
            <span className="eyebrow text-muted-foreground">{compare("packageLabel")}</span>
          </TableHead>
          {packages.map((entry) => (
            <TableHead
              key={entry.key}
              className="h-auto border-b border-l px-4 py-4 align-top whitespace-normal"
            >
              {/*
                The short trade name over the full catalogue name, the pairing the card sets: the
                column has to be identifiable at a glance while still tying to the name on the
                invoice.

                The cell is top aligned and the subtitle carries a two line minimum, rather than
                the whole block sitting on the cell's floor: "Compliance Check, EHS System &
                Culture Snapshot" wraps to two lines where the other three subtitles take one, so
                a bottom aligned block floated its trade name a line above the other three. This is
                the same fix `PackagesGrid` makes with its `minmax(4.75rem,auto)` name track --
                reserve the second line for every column, so a subtitle that needs only one leaves
                it empty and all four trade names start on one baseline.
              */}
              <span className="block text-heading-16">{t(`${entry.key}.shortName`)}</span>
              <span className="mt-1 block min-h-10 hyphens-auto wrap-break-word text-copy-13 font-normal text-muted-foreground">
                {t(`${entry.key}.name`)}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          /*
            `border-b-0` on the last row is the primitive's own rule, and it is right here: the
            frame draws that edge, so leaving the row's own would double it.
          */
          <TableRow key={row.key} className="hover:bg-transparent">
            <TableHead
              scope="row"
              className="sticky left-0 z-10 h-auto border-b bg-background px-4 py-4 align-top"
            >
              <span className="eyebrow text-muted-foreground">{row.label}</span>
            </TableHead>
            {packages.map((entry) => (
              <TableCell
                key={entry.key}
                className="border-b border-l px-4 py-4 align-top text-copy-14 whitespace-normal"
              >
                {row.cell(entry)}
              </TableCell>
            ))}
          </TableRow>
        ))}
        <TableRow className="hover:bg-transparent">
          <TableHead
            scope="row"
            className="sticky left-0 z-10 h-auto bg-background px-4 py-5 align-top"
          >
            <span className="eyebrow text-muted-foreground">{compare("priceLabel")}</span>
          </TableHead>
          {packages.map((entry) => (
            <TableCell key={entry.key} className="border-l px-4 py-5 align-top whitespace-normal">
              {entry.priceChf === null ? (
                /*
                  A sentence rather than a figure, so it takes copy size in the muted colour: at
                  the price size it would line up against three franc amounts and promise a number
                  it does not have, which is the reason the card steps its own "On demand" down a
                  size too.
                */
                <span className="text-copy-14 text-muted-foreground">
                  {compare("retainerPrice")}
                </span>
              ) : (
                <>
                  <span className="block text-heading-24 tabular-nums" data-numeric>
                    {format.number(entry.priceChf, "chfWhole")}
                  </span>
                  <span className="mt-1 block text-label-12 text-muted-foreground">
                    {pricing("vatNote")}
                  </span>
                </>
              )}
            </TableCell>
          ))}
        </TableRow>
      </TableBody>
    </Table>
  );
}
