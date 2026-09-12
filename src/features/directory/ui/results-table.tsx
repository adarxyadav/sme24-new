import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
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
 * unlock cell itself is the client `UnlockCell` of milestone 3b.
 */
export async function DirectoryResultsTable({ rows, countryLabel }: Props) {
  const [t, format] = await Promise.all([getTranslations("directory.results"), getFormatter()]);
  const price = format.number(rappenToChf(CREDIT_PRICE_RAPPEN), "chf");

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
                <TableCell>
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{row.companyName}</span>
                    {place ? <span className="text-muted-foreground text-xs">{place}</span> : null}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-col gap-0.5">
                    <span className={name ? "font-medium" : "text-muted-foreground"}>
                      {name ?? t("unnamed")}
                    </span>
                    {row.title ? (
                      <span className="text-muted-foreground text-xs">{row.title}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-xs" translate="no">
                  {row.unlocked && row.email ? row.email : row.emailMasked}
                </TableCell>
                <TableCell className="font-mono text-xs" translate="no">
                  <span className="flex flex-col gap-0.5">
                    <span>
                      {row.unlocked
                        ? (row.phone ?? row.mobile ?? t("none"))
                        : (row.phoneMasked ?? row.mobileMasked ?? t("none"))}
                    </span>
                    {row.unlocked && row.phone && row.mobile ? (
                      <span className="text-muted-foreground">{row.mobile}</span>
                    ) : null}
                    {!row.unlocked && row.phoneMasked && row.mobileMasked ? (
                      <span className="text-muted-foreground">{row.mobileMasked}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {row.unlocked ? (
                    <Badge variant="success">{t("unlocked")}</Badge>
                  ) : (
                    <span className="flex flex-col items-end gap-0.5">
                      <span className="whitespace-nowrap font-medium text-sm">
                        {t("price", { price })}
                      </span>
                      <span className="text-muted-foreground text-xs">{t("priceNote")}</span>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
