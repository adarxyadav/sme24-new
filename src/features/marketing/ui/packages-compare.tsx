import { useFormatter, useTranslations } from "next-intl";
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
 * "On demand". Server component.
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
      The table scrolls sideways under its own width rather than collapsing into four stacked
      blocks. Stacked, it would be the package cards a second time -- the same seven facts per
      package, one package at a time -- and comparing across packages is the only thing this
      section adds over the cards. The row labels stay in view while it scrolls, so a cell three
      columns in is still attributable to its row.

      The `tabIndex` makes the scroll container keyboard reachable, which the Web Interface
      Guidelines require of any scrollable region: a pointer can drag it, and without this a
      keyboard alone could not reach the columns off the right edge. Biome reads a `div` with a
      `tabIndex` as a non-interactive element in the tab order and would have it removed, which is
      the rule's usual case and wrong for a scroller, so the suppression is scoped to it.

      It takes no role: the page's own `section` is already the labelled landmark, and pointing a
      second element at the same heading id made two nested regions with one name -- ambiguous to
      a screen reader, and to any `querySelector` looking for the scroller. The `table` inside
      carries the structure a screen reader navigates by, and its `caption` names it, so the
      scroller only has to be focusable, not announced.
    */
    <div
      className="overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be keyboard reachable
      tabIndex={0}
    >
      {/*
        `min-w-4xl` is the width below which the five columns stop being readable, not a fixed
        table width: above it the table fills its container and the scroller never engages, which
        is why the desktop view has no cut edge. `table-fixed` with an explicit label column keeps
        the four package columns equal, so a long cell in one does not widen its column against
        the others -- the comparison only reads if the columns are comparable.
      */}
      {/*
        The closed hairline frame the packages and trust sections use, so the table reads as one
        block rather than a set of loose rules. `border-separate` with no spacing means the outer
        border and the cells' own edges meet without doubling: the cells draw their bottom and
        left rules, the frame draws the outside, and the last row leaves its bottom to the frame.
      */}
      <table className="w-full min-w-4xl table-fixed border border-separate border-spacing-0">
        <colgroup>
          <col className="w-40" />
          <col className="w-1/4" />
          <col className="w-1/4" />
          <col className="w-1/4" />
          <col className="w-1/4" />
        </colgroup>
        <caption className="sr-only">{compare("heading")}</caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="sticky left-0 z-10 border-b bg-background px-4 py-4 text-left align-top"
            >
              {/*
                The label is top aligned with the column heads beside it rather than sitting on
                the cell's floor, so it reads against the trade names rather than against the
                subtitles under them.
              */}
              <span className="eyebrow text-muted-foreground">{compare("packageLabel")}</span>
            </th>
            {packages.map((entry) => (
              <th
                scope="col"
                key={entry.key}
                className="border-b border-l px-4 py-4 text-left align-top"
              >
                {/*
                  The short trade name over the full catalogue name, the pairing the card sets:
                  the column has to be identifiable at a glance while still tying to the name on
                  the invoice.

                  The cell is top aligned and the subtitle carries a two line minimum, rather than
                  the whole block sitting on the cell's floor: "Compliance Check, EHS System &
                  Culture Snapshot" wraps to two lines where the other three subtitles take one, so
                  a bottom aligned block floated its trade name a line above the other three. This
                  is the same fix `PackagesGrid` makes with its `minmax(4.75rem,auto)` name track --
                  reserve the second line for every column, so a subtitle that needs only one leaves
                  it empty and all four trade names start on one baseline.
                */}
                <span className="block text-heading-16">{t(`${entry.key}.shortName`)}</span>
                <span className="mt-1 block min-h-10 hyphens-auto wrap-break-word text-copy-13 font-normal text-muted-foreground">
                  {t(`${entry.key}.name`)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th
                scope="row"
                className="sticky left-0 z-10 border-b bg-background px-4 py-4 text-left align-top"
              >
                <span className="eyebrow text-muted-foreground">{row.label}</span>
              </th>
              {packages.map((entry) => (
                <td key={entry.key} className="border-b border-l px-4 py-4 align-top text-copy-14">
                  {row.cell(entry)}
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <th
              scope="row"
              className="sticky left-0 z-10 bg-background px-4 py-5 text-left align-top"
            >
              <span className="eyebrow text-muted-foreground">{compare("priceLabel")}</span>
            </th>
            {packages.map((entry) => (
              <td key={entry.key} className="border-l px-4 py-5 align-top">
                {entry.priceChf === null ? (
                  /*
                    A sentence rather than a figure, so it takes copy size in the muted colour: at
                    the price size it would line up against three franc amounts and promise a
                    number it does not have, which is the reason the card steps its own "On demand"
                    down a size too.
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
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
