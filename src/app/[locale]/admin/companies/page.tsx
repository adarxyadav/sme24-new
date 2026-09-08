import { Building2Icon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
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
import { listCompanies } from "@/features/ops-admin/queries";
import { RunStatusBadge } from "@/features/research/ui/badges";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("adminCompanies");
  return { title: t("title") };
}

/**
 * The ops companies list (spec 0014, AC-1): every company across every organization with its
 * client, canton, headcount and the state of its newest research run, newest first, 25 to a page
 * on the keyset cursor. The cursor lives in the URL, so a reload or a shared link shows the same
 * page. Ops only, through the proxy and the ops policy.
 */
export default async function AdminCompaniesPage({ searchParams }: Props) {
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const [t, format, supabase] = await Promise.all([
    getTranslations("adminCompanies"),
    getFormatter(),
    createServerSupabaseClient(),
  ]);
  const page = await listCompanies(supabase, cursor);

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("description")} />
      {page.rows.length === 0 ? (
        <EmptyState icon={Building2Icon} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <section className="flex flex-col gap-4">
          <div className="overflow-x-auto">
            <Table density="compact">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.name")}</TableHead>
                  <TableHead>{t("columns.organization")}</TableHead>
                  <TableHead>{t("columns.canton")}</TableHead>
                  <TableHead className="text-right">{t("columns.employees")}</TableHead>
                  <TableHead>{t("columns.research")}</TableHead>
                  <TableHead>{t("columns.created")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-2">
                        <Link
                          href={{
                            pathname: "/admin/companies/[companyId]",
                            params: { companyId: row.id },
                          }}
                          className="font-medium underline underline-offset-4"
                        >
                          {row.name}
                        </Link>
                        {row.archivedAt ? <Badge variant="secondary">{t("archived")}</Badge> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{row.organizationName}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.canton ?? t("none")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.employeesCount === null
                        ? t("none")
                        : format.number(row.employeesCount, "integer")}
                    </TableCell>
                    <TableCell>
                      {row.latestRunStatus === null ? (
                        <span className="text-muted-foreground">{t("noRun")}</span>
                      ) : (
                        <RunStatusBadge status={row.latestRunStatus} />
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <time dateTime={row.createdAt}>
                        {format.dateTime(new Date(row.createdAt), "dateShort")}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {page.nextCursor ? (
            <div>
              <Button asChild variant="outline">
                <Link
                  href={{
                    pathname: "/admin/companies",
                    query: { cursor: page.nextCursor },
                  }}
                >
                  {t("more")}
                </Link>
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </PageStack>
  );
}
