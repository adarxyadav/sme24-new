import {
  ClockIcon,
  LayoutDashboardIcon,
  OctagonXIcon,
  SearchIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressList } from "@/components/ui/progress-list";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { RUN_LIMIT_PER_DAY, RUN_STEPS } from "@/features/research/catalogue";
import { type CompanyDashboard, getCompanyDashboard } from "@/features/research/queries";
import { KpiTable } from "@/features/research/ui/kpi-table";
import { LookupForm } from "@/features/research/ui/lookup-form";
import { RerunForm } from "@/features/research/ui/rerun-form";
import { RunProgress } from "@/features/research/ui/run-progress";
import { SourceList } from "@/features/research/ui/source-list";
import { SelfAssessmentSection } from "@/features/self-assessment/ui/self-assessment-section";
import { currentYear } from "@/features/self-assessment/years";
import { clientMessages } from "@/i18n/client-messages";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { organizationIdFromClaims } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The client dashboard (spec 0007, AC-3, AC-7, AC-8): the lookup form while the organization has
 * no company, else the company details, the latest run's live progress, the benchmark segment
 * (spec 0008, AC-9) once a run succeeded or a snapshot exists, the KPI table with its sources
 * once a run finished, the "Your figures" card in every run state (spec 0010, AC-1: after the
 * table once a run finished, else after the failed alert, else after the progress section),
 * and the edit and rerun form on the empty and failed states.
 */
export default async function AppPage() {
  const t = await getTranslations("research");
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const organizationId = organizationIdFromClaims(data?.claims);
  const locale = LOCALE_CODE[resolveLocale(await getLocale())];
  const messages = clientMessages(await getMessages(), ["research", "benchmark", "selfAssessment"]);

  if (!organizationId) {
    const areas = await getTranslations("areas.app");
    return (
      <PageStack>
        <PageHeader title={areas("title")} description={areas("body")} />
        <EmptyState
          icon={LayoutDashboardIcon}
          title={areas("empty.title")}
          description={areas("empty.description")}
        />
      </PageStack>
    );
  }

  const [dashboard, organization] = await Promise.all([
    getCompanyDashboard(supabase, organizationId),
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
  ]);

  if (!dashboard.company) {
    return (
      <PageStack>
        <PageHeader title={t("title")} description={t("description")} />
        <NextIntlClientProvider messages={messages}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Card>
              <CardHeader>
                <CardTitle>{t("lookup.title")}</CardTitle>
                <CardDescription>{t("lookup.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <LookupForm organizationName={organization.data?.name ?? ""} />
              </CardContent>
            </Card>
            <section
              aria-labelledby="next-heading"
              className="flex flex-col gap-6 rounded-lg border p-6"
            >
              <div className="flex flex-col gap-2">
                <h2 id="next-heading" className="font-semibold text-lg">
                  {t("lookup.nextTitle")}
                </h2>
                <p className="max-w-prose text-muted-foreground text-sm">{t("lookup.nextBody")}</p>
              </div>
              <ProgressList
                items={RUN_STEPS.map((step) => ({
                  id: step,
                  label: t(`steps.${step}`),
                  state: "pending",
                }))}
                aria-label={t("lookup.nextTitle")}
              />
              <ul className="flex flex-col gap-2 text-muted-foreground text-sm">
                <li className="flex items-center gap-2">
                  <ClockIcon className="size-4 shrink-0" aria-hidden="true" />
                  {t("lookup.durationNote")}
                </li>
                <li className="flex items-center gap-2">
                  <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
                  {t("lookup.quotaNote", { limit: RUN_LIMIT_PER_DAY })}
                </li>
                <li className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
                  {t("lookup.trustNote")}
                </li>
              </ul>
            </section>
          </div>
        </NextIntlClientProvider>
      </PageStack>
    );
  }

  const { company, latestRun, quota } = dashboard;
  const finished = latestRun?.status === "succeeded" || latestRun?.status === "empty";
  const blocked = quota.openRunId ? "open" : quota.remaining <= 0 ? "quota" : null;
  const details = companyDetails(dashboard, t);
  const failed = latestRun?.status === "failed";
  const selfAssessment = (
    <SelfAssessmentSection
      companyId={company.id}
      catalogue={dashboard.catalogue}
      rows={dashboard.kpiRows}
      currentYear={currentYear(new Date())}
      locale={locale}
    />
  );

  return (
    <PageStack>
      <PageHeader title={company.name} description={details} />
      <NextIntlClientProvider messages={messages}>
        <section aria-labelledby="research-heading" className="flex flex-col gap-4">
          <h2 id="research-heading" className="font-semibold text-lg">
            {t("progress.heading")}
          </h2>
          <Card>
            <CardContent>
              {latestRun ? (
                <RunProgress
                  run={latestRun}
                  quota={quota}
                  companyId={company.id}
                  benchmarkState={dashboard.benchmarkState}
                />
              ) : (
                <p className="text-muted-foreground text-sm">{t("progress.resultsPending")}</p>
              )}
            </CardContent>
          </Card>
        </section>
        {!finished && !failed ? selfAssessment : null}

        {dashboard.benchmark || latestRun?.status === "succeeded" ? (
          <BenchmarkSegment
            snapshot={dashboard.benchmark}
            state={dashboard.benchmarkState}
            catalogue={dashboard.catalogue}
            assumptions={dashboard.benchmarkAssumptions}
            company={{
              id: company.id,
              industryCode: company.industry_code,
              employeesCount: company.employees_count,
            }}
            locale={locale}
          />
        ) : null}

        {latestRun?.status === "empty" ? (
          <Alert variant="info">
            <SearchIcon aria-hidden="true" />
            <AlertTitle>{t("empty.title")}</AlertTitle>
            <AlertDescription>
              <p>{t("empty.description")}</p>
              <p>{t("empty.manualNote")}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        {latestRun?.status === "failed" ? (
          <Alert variant="destructive">
            <OctagonXIcon aria-hidden="true" />
            <AlertTitle>{t("failed.title")}</AlertTitle>
            <AlertDescription>
              <p>
                {t(`errors.${(latestRun.error_code ?? "internal") as "internal"}`, {
                  limit: RUN_LIMIT_PER_DAY,
                })}
              </p>
              <p>{t("failed.manualNote")}</p>
            </AlertDescription>
          </Alert>
        ) : null}
        {failed ? selfAssessment : null}

        {finished ? (
          <section aria-labelledby="kpis-heading" className="flex flex-col gap-4">
            <h2 id="kpis-heading" className="font-semibold text-lg">
              {t("table.heading")}
            </h2>
            <KpiTable
              catalogue={dashboard.catalogue}
              years={dashboard.years}
              kpis={dashboard.kpis}
              locale={locale}
            />
          </section>
        ) : null}
        {finished ? selfAssessment : null}

        {latestRun?.status === "empty" || latestRun?.status === "failed" ? (
          <section aria-labelledby="rerun-heading" className="flex flex-col gap-4">
            <Card className="max-w-2xl">
              <CardHeader>
                <CardTitle id="rerun-heading">{t("rerun.title")}</CardTitle>
                <CardDescription>{t("rerun.description")}</CardDescription>
              </CardHeader>
              <CardContent>
                <RerunForm
                  company={{
                    id: company.id,
                    name: company.name,
                    legalName: company.legal_name,
                    website: company.website,
                  }}
                  blocked={blocked}
                />
              </CardContent>
            </Card>
          </section>
        ) : null}

        {finished ? <SourceList sources={latestRun.parsedSummary?.sources ?? []} /> : null}
      </NextIntlClientProvider>
    </PageStack>
  );
}

/** The one line of company details under the title: legal name, website, canton, UID. */
function companyDetails(
  { company }: CompanyDashboard,
  t: Awaited<ReturnType<typeof getTranslations<"research">>>,
): string | undefined {
  if (!company) return undefined;
  const parts = [
    company.legal_name,
    company.website?.replace(/^https:\/\//, ""),
    company.canton ? `${t("details.canton")} ${company.canton}` : null,
    company.uid ? `${t("details.uid")} ${company.uid}` : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : undefined;
}
