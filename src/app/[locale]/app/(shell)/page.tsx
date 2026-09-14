import { ClockIcon, LayoutDashboardIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressList } from "@/components/ui/progress-list";
import { listAssessmentStates } from "@/features/assessments/queries";
import { listAssignedExperts } from "@/features/experts/queries";
import { AssignedExperts } from "@/features/experts/ui/assigned-experts";
import { listScheduledAssessments } from "@/features/ops-admin/queries";
import { ScheduledAssessments } from "@/features/ops-admin/ui/scheduled-assessments";
import { RUN_LIMIT_PER_DAY, RUN_STEPS } from "@/features/research/catalogue";
import { getCompanyDashboard } from "@/features/research/queries";
import { CompanyDashboardView } from "@/features/research/ui/company-dashboard";
import { LookupForm } from "@/features/research/ui/lookup-form";
import { clientMessages } from "@/i18n/client-messages";
import { organizationIdFromClaims } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The client dashboard (spec 0007, AC-3, AC-7, AC-8): the lookup form while the organization has
 * no company at all, else the organization's first company rendered by the shared
 * `CompanyDashboardView`. An organization may now hold several companies, and `/app/companies`
 * lists them; this page stays the way in to the first one, so every existing link and bookmark
 * still lands somewhere useful.
 *
 * Spec 0014 (AC-10) adds the booked assessments card beside the expert card: one entry per booked
 * order, each with its own date and its own assessor.
 */
export default async function AppPage() {
  const t = await getTranslations("research");
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const organizationId = organizationIdFromClaims(data?.claims);
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

  const [dashboard, organization, assignedExperts, assessments] = await Promise.all([
    getCompanyDashboard(supabase, organizationId),
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    listAssignedExperts(supabase, organizationId),
    listScheduledAssessments(supabase),
  ]);
  // Spec 0019, AC-10: the state of each booking's assessments, read from `assessments` alone under
  // the member policy; this route never queries an answer row.
  const assessmentStates = await listAssessmentStates(
    supabase,
    assessments.map((assessment) => assessment.orderId),
  );
  // Spec 0013, AC-12 and spec 0014, AC-10: both cards sit immediately after the header in every
  // state of the dashboard, and each renders nothing at all while it has nothing to show. The
  // booking comes first: a date the client is waiting on outranks the profile of who is coming.
  const experts = (
    <>
      <ScheduledAssessments
        assessments={assessments}
        experts={assignedExperts}
        states={assessmentStates}
      />
      <AssignedExperts experts={assignedExperts} />
    </>
  );

  if (!dashboard.company) {
    return (
      <PageStack>
        <PageHeader title={t("title")} description={t("description")} />
        {experts}
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

  return (
    <CompanyDashboardView
      supabase={supabase}
      organizationId={organizationId}
      dashboard={{ ...dashboard, company: dashboard.company }}
      beforeResearch={experts}
    />
  );
}
