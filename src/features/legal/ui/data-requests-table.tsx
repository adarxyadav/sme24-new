import { SearchXIcon, ShieldCheckIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DataRequestRow } from "@/features/legal/queries";
import { isOverdue } from "@/features/legal/queries";
import type { DataRequestFilters, DataRequestStatus } from "@/features/legal/schema";
import { Link } from "@/i18n/navigation";

export type DataRequestsTableProps = {
  readonly rows: readonly DataRequestRow[];
  readonly nextCursor: string | null;
  readonly filters: DataRequestFilters;
  /** The server's clock at render, so "overdue" is decided once rather than per row in the browser. */
  readonly now: Date;
};

/**
 * The ops queue of data requests (spec 0015, AC-13): deadline first, then the right, the subject,
 * their client organization, the filing date and the status.
 *
 * Ordered by `due_at` ascending rather than by filing date, because the thing this list exists to
 * prevent is a missed thirty day answer window, and the row closest to its deadline is the one
 * that must be at the top whatever day it arrived. An open row past its deadline carries the
 * overdue badge, which is the only place the comparison is shown.
 *
 * Server component: a data request changes only when ops change it, so there is nothing live to
 * subscribe to.
 */
export function DataRequestsTable({ rows, nextCursor, filters, now }: DataRequestsTableProps) {
  const t = useTranslations("adminDataRequests");
  const format = useFormatter();
  const filtered = filters.status !== "all";
  const baseQuery = filters.status === "open" ? {} : { status: filters.status };

  return (
    <section aria-labelledby="data-requests-heading" className="flex flex-col gap-3">
      <h2 id="data-requests-heading" className="font-semibold text-lg">
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
                <Link href={{ pathname: "/admin/data-requests", query: { status: "all" } }}>
                  {t("filters.all")}
                </Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={ShieldCheckIcon}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        )
      ) : (
        <div className="rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.due")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.subject")}</TableHead>
                <TableHead>{t("columns.organization")}</TableHead>
                <TableHead>{t("columns.filed")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-request-id={row.id}>
                  <TableCell className="tabular-nums whitespace-nowrap" data-numeric>
                    <span className="flex items-center gap-2">
                      <time dateTime={row.due_at}>
                        {format.dateTime(new Date(row.due_at), "dateShort")}
                      </time>
                      {isOverdue(row, now) ? (
                        <Badge variant="destructive">{t("overdue")}</Badge>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={{ pathname: "/admin/data-requests/[id]", params: { id: row.id } }}
                      className="underline underline-offset-4"
                    >
                      {t(`kinds.${row.kind as "export" | "deletion"}`)}
                    </Link>
                  </TableCell>
                  <TableCell>{row.subject?.full_name ?? t("noName")}</TableCell>
                  <TableCell>{row.organization?.name ?? t("noOrganization")}</TableCell>
                  <TableCell className="tabular-nums" data-numeric>
                    <time dateTime={row.created_at}>
                      {format.dateTime(new Date(row.created_at), "dateShort")}
                    </time>
                  </TableCell>
                  <TableCell>
                    <DataRequestStatusBadge status={row.status as DataRequestStatus} />
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
              <Link href={{ pathname: "/admin/data-requests", query: baseQuery }}>
                {t("pagination.first")}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nextCursor ? (
            <Button asChild variant="outline">
              <Link
                href={{
                  pathname: "/admin/data-requests",
                  query: { ...baseQuery, cursor: nextCursor },
                }}
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

/** The status of one request as a badge; `refused` is outlined rather than red, because a refusal with a reason is a legitimate answer. Server or browser. */
export function DataRequestStatusBadge({ status }: { readonly status: DataRequestStatus }) {
  const t = useTranslations("adminDataRequests");
  const variant =
    status === "fulfilled" ? "secondary" : status === "refused" ? "outline" : "default";
  return <Badge variant={variant}>{t(`status.${status}`)}</Badge>;
}
