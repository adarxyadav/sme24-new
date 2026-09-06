import { InboxIcon, SearchXIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Enquiry } from "@/features/enquiries/queries";
import type { EnquiryFilters } from "@/features/enquiries/schema";
import { Link } from "@/i18n/navigation";
import { EnquiryStatusBadge } from "./enquiry-status-badge";

export type EnquiriesTableProps = {
  readonly rows: readonly Enquiry[];
  readonly nextCursor: string | null;
  readonly filters: EnquiryFilters;
};

/**
 * The enquiries list (spec 0009, AC-12): received, topic, company, contact and status, newest
 * first, every row a link to its detail page, the keyset cursor under it. The status filter is
 * `new` by default, so the empty state says whether the filter or the table is empty. Server
 * component (no live updates: an enquiry changes only when ops change it).
 */
export function EnquiriesTable({ rows, nextCursor, filters }: EnquiriesTableProps) {
  const t = useTranslations("enquiries");
  const format = useFormatter();
  const filtered = filters.status !== "all";
  const baseQuery = filters.status === "new" ? {} : { status: filters.status };

  return (
    <section aria-labelledby="enquiries-heading" className="flex flex-col gap-3">
      <h2 id="enquiries-heading" className="font-semibold text-lg">
        {t("listHeading")}
      </h2>
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchXIcon}
            title={t("noResults.title")}
            description={t("noResults.description")}
            action={
              <Button asChild variant="outline">
                <Link href={{ pathname: "/admin/enquiries", query: { status: "all" } }}>
                  {t("filters.all")}
                </Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={InboxIcon}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        )
      ) : (
        <div className="rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.received")}</TableHead>
                <TableHead>{t("columns.topic")}</TableHead>
                <TableHead>{t("columns.company")}</TableHead>
                <TableHead>{t("columns.contact")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-enquiry-id={row.id}>
                  <TableCell className="tabular-nums" data-numeric>
                    <time dateTime={row.created_at}>
                      {format.dateTime(new Date(row.created_at), "dateTime")}
                    </time>
                  </TableCell>
                  <TableCell>
                    {row.topic === "retainer" || row.topic === "general"
                      ? t(`topics.${row.topic}`)
                      : row.topic}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={{ pathname: "/admin/enquiries/[id]", params: { id: row.id } }}
                      className="underline underline-offset-4"
                    >
                      {row.company_name}
                    </Link>
                  </TableCell>
                  <TableCell>{row.contact_name}</TableCell>
                  <TableCell>
                    <EnquiryStatusBadge status={row.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {nextCursor || filters.cursor ? (
        <nav aria-label={t("listHeading")} className="flex items-center justify-between gap-3">
          {filters.cursor ? (
            <Button asChild variant="ghost">
              <Link href={{ pathname: "/admin/enquiries", query: baseQuery }}>
                {t("pagination.first")}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nextCursor ? (
            <Button asChild variant="outline">
              <Link
                href={{ pathname: "/admin/enquiries", query: { ...baseQuery, cursor: nextCursor } }}
              >
                {t("pagination.next")}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
