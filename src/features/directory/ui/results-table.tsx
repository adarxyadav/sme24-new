import { getFormatter, getTranslations } from "next-intl/server";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rappenToChf } from "@/features/checkout/money";
import { CREDIT_PRICE_RAPPEN } from "@/features/directory/catalogue";
import type { DirectoryRow } from "@/features/directory/queries";
import { UnlockCell } from "@/features/directory/ui/unlock-cell";

type Props = {
  readonly rows: readonly DirectoryRow[];
  /** Country names in the reader's language, keyed by alpha 2 code. */
  readonly countryLabel: (code: string | null) => string | null;
};

/** The contact's name, or the title alone when the list gave no name. */
function fullName(row: DirectoryRow): string | null {
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ");
  return name.length > 0 ? name : null;
}

/**
 * The masked results of a directory search (spec 0018, AC-5): company, contact, the masked
 * email and phones, and per row the price of a reveal or, once unlocked, the raw values. Masked
 * and raw values are set in the mono face, the way every identifier is. Server component; the
 * three cells that move on an unlock are the client `UnlockCell`, inside a `DirectoryProvider`.
 */
export async function DirectoryResultsTable({ rows, countryLabel }: Props) {
  const [t, format] = await Promise.all([getTranslations("directory.results"), getFormatter()]);
  // "1 credit, CHF 1.99": the unit price through the chf format, no five Rappen rounding, because
  // a unit price is not a cash total (spec 0011 rounds totals only).
  const price = t("price", { price: format.number(rappenToChf(CREDIT_PRICE_RAPPEN), "chf") });

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.company")}</TableHead>
            <TableHead>{t("columns.contact")}</TableHead>
            <TableHead>{t("columns.email")}</TableHead>
            <TableHead>{t("columns.phone")}</TableHead>
            <TableHead className="text-right">{t("columns.unlock")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const place = [
              row.city ?? row.companyCity,
              countryLabel(row.country ?? row.companyCountry),
            ]
              .filter(Boolean)
              .join(", ");
            const name = fullName(row);
            return (
              <TableRow key={row.contactId}>
                {/* The two text cells wrap inside a bounded width, so a long company name or
                    title widens neither the table nor the page; the identifier cells stay on one
                    line and the box scrolls when the viewport is narrower than the five columns. */}
                <TableCell className="min-w-56 max-w-[18rem] break-words whitespace-normal">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{row.companyName}</span>
                    {place ? <span className="text-muted-foreground text-xs">{place}</span> : null}
                  </span>
                </TableCell>
                <TableCell className="min-w-48 max-w-[16rem] break-words whitespace-normal">
                  <span className="flex flex-col gap-0.5">
                    <span className={name ? "font-medium" : "text-muted-foreground"}>
                      {name ?? t("unnamed")}
                    </span>
                    {row.title ? (
                      <span className="text-muted-foreground text-xs">{row.title}</span>
                    ) : null}
                  </span>
                </TableCell>
                <UnlockCell
                  contactId={row.contactId}
                  emailMasked={row.emailMasked}
                  phoneMasked={row.phoneMasked}
                  mobileMasked={row.mobileMasked}
                  unlocked={row.unlocked}
                  email={row.email}
                  phone={row.phone}
                  mobile={row.mobile}
                  priceLabel={price}
                />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
