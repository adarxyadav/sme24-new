import type { SupabaseClient } from "@supabase/supabase-js";
import { OctagonXIcon, SearchIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import type { BreadcrumbEntry } from "@/components/page-header";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { BenchmarkViewed } from "@/features/benchmark/ui/benchmark-viewed";
import { loadExpertSuggestions } from "@/features/experts/queries";
import { RUN_LIMIT_PER_DAY } from "@/features/research/catalogue";
import type { CompanyDashboard as Dashboard } from "@/features/research/queries";
import { KpiTable } from "@/features/research/ui/kpi-table";
import { RerunForm } from "@/features/research/ui/rerun-form";
import { RunProgress } from "@/features/research/ui/run-progress";
import { SourceList } from "@/features/research/ui/source-list";
import { SelfAssessmentSection } from "@/features/self-assessment/ui/self-assessment-section";
import { currentYear } from "@/features/self-assessment/years";
import { clientMessages } from "@/i18n/client-messages";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { regionCountriesOf } from "@/lib/countries";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

type Props = {
  readonly supabase: Client;
  readonly organizationId: string;
  /** A dashboard whose `company` is not null; the caller decides what an absent company means. */
  readonly dashboard: Dashboard & { readonly company: NonNullable<Dashboard["company"]> };
  /** Rendered between the header and the research section: the experts and bookings cards. */
  readonly beforeResearch?: React.ReactNode;
  readonly breadcrumb?: readonly BreadcrumbEntry[];
};

/**
 * One company's research and benchmark, the body `/app` and `/app/companies/[companyId]` share
 * (spec 0007, AC-7, AC-8): the latest run's live progress, the benchmark segment (spec 0008,
 * AC-9) once a run succeeded or a snapshot exists, the KPI table with its sources once a run
 * finished, the "Your figures" card in every run state (spec 0010, AC-1: after the table once a
 * run finished, else after the failed alert, else after the progress section), and the edit and
 * rerun form on the empty and failed states. Extracted verbatim from the `/app` page when one
 * organization gained the ability to hold several companies. Server component.
 */
export async function CompanyDashboardView({
  supabase,
  organizationId,
  dashboard,
  beforeResearch,
  breadcrumb,
}: Props) {
  const t = await getTranslations("research");
  const locale = LOCALE_CODE[resolveLocale(await getLocale())];
  const messages = clientMessages(await getMessages(), ["research", "benchmark", "selfAssessment"]);
  const { company, latestRun, quota } = dashboard;

  const finished = latestRun?.status === "succeeded" || latestRun?.status === "empty";
  const blocked = quota.openRunId ? "open" : quota.remaining <= 0 ? "quota" : null;
  const details = companyDetails(dashboard, t);
  const failed = latestRun?.status === "failed";
  // `noData` renders the card into the benchmark segment (see `figuresSlot`), so every other
  // render site on this page stands down: an older snapshot with a failed or still running rerun
  // reaches this state too, not only a finished one.
  const figuresInBenchmark = dashboard.benchmarkState === "noData";
  // Spec 0022, AC-18: a snapshot written under a model version this code no longer reads shows one
  // sentence and the rerun form, because running the research again is the only thing that replaces
  // it (no recompute runs on deploy). The run itself succeeded, so without this the sentence would
  // ask for a rerun the page offers nowhere.
  const outdated = dashboard.benchmarkState === "outdated";
  // Spec 0022, AC-22: the three experts to suggest beside the benchmark, chosen by the database
  // function from the company's own section and country. Only worth a query when a readable
  // snapshot will actually render the cards, and the section is what the function matches on.
  const suggestionSection =
    dashboard.benchmarkState === "ready"
      ? (dashboard.benchmark?.blocks?.inputs.section ?? null)
      : null;
  const expertSuggestions = suggestionSection
    ? await loadExpertSuggestions(supabase, {
        section: suggestionSection,
        country: company.country,
        regionCountries: regionCountriesOf(company.country),
      })
    : [];
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
      <PageHeader title={company.name} description={details} breadcrumb={breadcrumb} />
      {beforeResearch}
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
        {!finished && !failed && !figuresInBenchmark ? selfAssessment : null}

        {dashboard.benchmark || latestRun?.status === "succeeded" ? (
          <BenchmarkSegment
            snapshot={dashboard.benchmark}
            state={dashboard.benchmarkState}
            company={{
              id: company.id,
              industryCode: company.industry_code,
              employeesCount: company.employees_count,
              country: company.country,
            }}
            locale={locale}
            // `noData` is the one state where entering a figure by hand is the fix the alert is
            // asking for, so the card moves up beside it instead of sitting below the KPI table.
            figuresSlot={figuresInBenchmark ? selfAssessment : undefined}
            experts={expertSuggestions}
            companyName={company.name}
          />
        ) : null}
        {/* Spec 0017, AC-6: the one browser event, fired only when a snapshot actually rendered.
            Guarded on the snapshot rather than on the segment, because the segment also renders
            the calculating, unavailable and noData states, none of which is a benchmark to view.
            The expert's read only view of the same segment deliberately does not fire it: an
            expert reading a client's page is not a client viewing their own benchmark. */}
        {dashboard.benchmark && dashboard.benchmarkState === "ready" ? (
          <BenchmarkViewed
            organizationId={organizationId}
            companyId={company.id}
            snapshotId={dashboard.benchmark.id}
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
        {failed && !figuresInBenchmark ? selfAssessment : null}

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
        {/* Not when `noData` already rendered it into the benchmark segment above, or the one
            card would appear twice on the same page. */}
        {finished && !figuresInBenchmark ? selfAssessment : null}

        {latestRun?.status === "empty" || latestRun?.status === "failed" || outdated ? (
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
                    country: company.country,
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
  { company }: Dashboard,
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
