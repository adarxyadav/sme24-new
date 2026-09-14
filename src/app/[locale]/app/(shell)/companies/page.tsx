import { Building2Icon, PlusIcon } from "lucide-react";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listClientCompanies } from "@/features/research/queries";
import { RunStatusBadge } from "@/features/research/ui/badges";
import { Link } from "@/i18n/navigation";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { organizationIdFromClaims } from "@/lib/auth/roles";
import { countryName } from "@/lib/countries";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("clientCompanies");
  return { title: t("title") };
}

/**
 * The client's own companies list: every company the organization has analysed, newest first, each
 * with the state of its newest research run, plus the button that starts another analysis. One
 * organization may hold several companies (a group and its subsidiaries), so this is the way in to
 * each of them; `/app` still opens the first. Client member, through the member policies.
 */
export default async function ClientCompaniesPage() {
  const [t, format, supabase, locale] = await Promise.all([
    getTranslations("clientCompanies"),
    getFormatter(),
    createServerSupabaseClient(),
    getLocale(),
  ]);
  const localeCode = LOCALE_CODE[resolveLocale(locale)];
  const { data } = await supabase.auth.getClaims();
  const organizationId = organizationIdFromClaims(data?.claims);
  const companies = organizationId ? await listClientCompanies(supabase, organizationId) : [];

  const newAnalysis = (
    <Button asChild>
      <Link href="/app/companies/new">
        <PlusIcon aria-hidden="true" />
        {t("newAnalysis")}
      </Link>
    </Button>
  );

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("description")} actions={newAnalysis} />
      {companies.length === 0 ? (
        <EmptyState
          icon={Building2Icon}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={newAnalysis}
        />
      ) : (
        <div className="overflow-x-auto">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.location")}</TableHead>
                <TableHead className="text-right">{t("columns.employees")}</TableHead>
                <TableHead>{t("columns.research")}</TableHead>
                <TableHead>{t("columns.created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>
                    <Link
                      href={{
                        pathname: "/app/companies/[companyId]",
                        params: { companyId: company.id },
                      }}
                      className="font-medium underline underline-offset-4"
                    >
                      {company.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {[company.canton, countryName(company.country, localeCode)]
                      .filter((part): part is string => Boolean(part))
                      .join(" · ")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {company.employeesCount === null
                      ? t("none")
                      : format.number(company.employeesCount, "integer")}
                  </TableCell>
                  <TableCell>
                    {company.latestRunStatus === null ? (
                      <span className="text-muted-foreground">{t("noRun")}</span>
                    ) : (
                      <RunStatusBadge status={company.latestRunStatus} />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <time dateTime={company.createdAt}>
                      {format.dateTime(new Date(company.createdAt), "dateShort")}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </PageStack>
  );
}
