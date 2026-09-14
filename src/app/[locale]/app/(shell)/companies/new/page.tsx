import { ClockIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProgressList } from "@/components/ui/progress-list";
import { RUN_LIMIT_PER_DAY, RUN_STEPS } from "@/features/research/catalogue";
import { LookupForm } from "@/features/research/ui/lookup-form";
import { clientMessages } from "@/i18n/client-messages";

export async function generateMetadata() {
  const t = await getTranslations("clientCompanies");
  return { title: t("newTitle") };
}

/**
 * Starts another analysis: the same lookup form the dashboard shows on an empty organization,
 * on its own page so a client with companies already can add one. The form posts
 * `requestResearch`, which no longer refuses a second company, and sends the client to that
 * company's page. Client member.
 */
export default async function NewAnalysisPage() {
  const [t, research, messages] = await Promise.all([
    getTranslations("clientCompanies"),
    getTranslations("research"),
    getMessages().then((all) => clientMessages(all, ["research"])),
  ]);

  return (
    <PageStack>
      <PageHeader
        title={t("newTitle")}
        description={t("newDescription")}
        breadcrumb={[{ label: t("title"), href: "/app/companies" }, { label: t("newTitle") }]}
      />
      <NextIntlClientProvider messages={messages}>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card>
            <CardHeader>
              {/* Not `research.lookup.description`, which says the name comes from the
                  organization: true of the first company, wrong of every one after it. */}
              <CardTitle>{research("lookup.title")}</CardTitle>
              <CardDescription>{t("formDescription")}</CardDescription>
            </CardHeader>
            <CardContent>
              {/* Not prefilled with the organization name here: the first company is usually the
                  client's own, but a second is a subsidiary or a peer, so an empty field is right. */}
              <LookupForm organizationName="" redirectToCompany />
            </CardContent>
          </Card>
          <section
            aria-labelledby="next-heading"
            className="flex flex-col gap-6 rounded-lg border p-6"
          >
            <div className="flex flex-col gap-2">
              <h2 id="next-heading" className="font-semibold text-lg">
                {research("lookup.nextTitle")}
              </h2>
              <p className="max-w-prose text-muted-foreground text-sm">
                {research("lookup.nextBody")}
              </p>
            </div>
            <ProgressList
              items={RUN_STEPS.map((step) => ({
                id: step,
                label: research(`steps.${step}`),
                state: "pending",
              }))}
              aria-label={research("lookup.nextTitle")}
            />
            <ul className="flex flex-col gap-2 text-muted-foreground text-sm">
              <li className="flex items-center gap-2">
                <ClockIcon className="size-4 shrink-0" aria-hidden="true" />
                {research("lookup.durationNote")}
              </li>
              <li className="flex items-center gap-2">
                <SearchIcon className="size-4 shrink-0" aria-hidden="true" />
                {research("lookup.quotaNote", { limit: RUN_LIMIT_PER_DAY })}
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheckIcon className="size-4 shrink-0" aria-hidden="true" />
                {research("lookup.trustNote")}
              </li>
            </ul>
          </section>
        </div>
      </NextIntlClientProvider>
    </PageStack>
  );
}
