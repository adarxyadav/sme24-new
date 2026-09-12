import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listAssessments } from "@/features/assessments/queries";
import { AssessmentsSection } from "@/features/assessments/ui/assessments-section";
import { BenchmarkSegment } from "@/features/benchmark/ui/benchmark-segment";
import { getAssignedClient, industrySection } from "@/features/experts/queries";
import { KpiTable } from "@/features/research/ui/kpi-table";
import { clientMessages } from "@/i18n/client-messages";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly params: Promise<{ readonly organizationId: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("experts.client");
  return { title: t("title") };
}

/**
 * One assigned client, read only (spec 0013, AC-11): the company facts, the KPI table and the
 * benchmark the client already saw, plus who to call on site. Every read runs under the assigned
 * expert policies, so an organization the caller does not hold returns nothing and the page is a
 * plain 404: one answer whether the assignment ended, never existed, or the id is nonsense.
 */
export default async function ExpertClientPage({ params }: Props) {
  const { organizationId } = await params;
  const [t, catalogue, supabase, messages, locale] = await Promise.all([
    getTranslations("experts.client"),
    getTranslations("experts.catalogue"),
    createServerSupabaseClient(),
    getMessages(),
    getLocale(),
  ]);

  const client = await getAssignedClient(supabase, organizationId);
  if (!client) notFound();
  const assessments = await listAssessments(supabase, organizationId);

  const { dashboard, contacts } = client;
  const { company, latestRun } = dashboard;
  const localeCode = LOCALE_CODE[resolveLocale(locale)];
  const finished = latestRun?.status === "succeeded" || latestRun?.status === "empty";
  const section = industrySection(company?.industry_code ?? null);

  const facts: ReadonlyArray<readonly [string, string]> = [
    [t("facts.legalName"), company?.legal_name ?? t("facts.none")],
    [t("facts.uid"), company?.uid ?? t("facts.none")],
    [t("facts.canton"), company?.canton ?? t("facts.none")],
    [t("facts.industry"), section ? catalogue(`industries.${section as "A"}`) : t("facts.none")],
    [
      t("facts.employees"),
      company?.employees_count === null || company?.employees_count === undefined
        ? t("facts.none")
        : String(company.employees_count),
    ],
    [t("facts.website"), company?.website?.replace(/^https:\/\//, "") ?? t("facts.none")],
  ];

  return (
    <PageStack>
      <PageHeader
        title={company?.name ?? client.organizationName}
        description={t("lead", { organization: client.organizationName })}
      />

      <section aria-labelledby="client-facts-heading" className="flex flex-col gap-4">
        <h2 id="client-facts-heading" className="font-semibold text-lg">
          {t("facts.heading")}
        </h2>
        <Card>
          <CardContent>
            <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
              {facts.map(([label, value]) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="text-muted-foreground text-sm">{label}</dt>
                  <dd className="font-medium text-sm">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </section>

      <NextIntlClientProvider messages={clientMessages(messages, ["assessments"])}>
        <AssessmentsSection
          organizationId={organizationId}
          companyId={company?.id ?? null}
          rows={assessments}
          locale={localeCode}
        />
      </NextIntlClientProvider>

      <NextIntlClientProvider
        messages={clientMessages(messages, ["research", "benchmark", "experts"])}
      >
        {dashboard.benchmark || latestRun?.status === "succeeded" ? (
          <BenchmarkSegment
            snapshot={dashboard.benchmark}
            state={dashboard.benchmarkState}
            catalogue={dashboard.catalogue}
            assumptions={dashboard.benchmarkAssumptions}
            company={{
              id: company?.id ?? "",
              industryCode: company?.industry_code ?? null,
              employeesCount: company?.employees_count ?? null,
            }}
            locale={localeCode}
            // The facts belong to the client; an expert reads them and calls if they are wrong.
            readOnly
          />
        ) : null}

        {finished ? (
          <section aria-labelledby="client-kpis-heading" className="flex flex-col gap-4">
            <h2 id="client-kpis-heading" className="font-semibold text-lg">
              {t("kpis.heading")}
            </h2>
            <KpiTable
              catalogue={dashboard.catalogue}
              years={dashboard.years}
              kpis={dashboard.kpis}
              locale={localeCode}
            />
          </section>
        ) : (
          <section aria-labelledby="client-kpis-heading" className="flex flex-col gap-4">
            <h2 id="client-kpis-heading" className="font-semibold text-lg">
              {t("kpis.heading")}
            </h2>
            <p className="text-muted-foreground text-sm">{t("kpis.pending")}</p>
          </section>
        )}
      </NextIntlClientProvider>

      <section aria-labelledby="client-contacts-heading" className="flex flex-col gap-4">
        <h2 id="client-contacts-heading" className="font-semibold text-lg">
          {t("contacts.heading")}
        </h2>
        <Card>
          <CardHeader>
            <CardTitle className="font-normal text-muted-foreground text-sm">
              {t("contacts.description")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {contacts.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("contacts.none")}</p>
            ) : (
              <ul className="flex flex-col gap-3" data-client-contacts>
                {contacts.map((contact) => (
                  <li key={contact.userId} className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm">
                      {contact.fullName ?? t("contacts.unnamed")}
                    </span>
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-muted-foreground text-sm underline underline-offset-4"
                    >
                      {contact.email}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </PageStack>
  );
}
