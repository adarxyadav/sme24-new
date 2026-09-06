import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getEnquiry } from "@/features/enquiries/queries";
import { EnquiryStatusBadge, isEnquiryStatus } from "@/features/enquiries/ui/enquiry-status-badge";
import { EnquiryStatusForm } from "@/features/enquiries/ui/enquiry-status-form";
import { clientMessages } from "@/i18n/client-messages";
import { languageName } from "@/lib/alerts/registry";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("enquiries");
  return { title: t("detailTitle") };
}

/**
 * One enquiry (spec 0009, AC-12): every stored field except the address hash, the language
 * name, the sender's organization when the row links to one, and the workflow form. Ops only
 * through the proxy and RLS; an unknown id renders the not found page.
 */
export default async function AdminEnquiryDetailPage({ params }: Props) {
  const { id } = await params;
  const [t, nav, format, supabase, messages] = await Promise.all([
    getTranslations("enquiries"),
    getTranslations("nav.admin"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const row = await getEnquiry(supabase, id);
  if (!row) notFound();

  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), "dateTime") : t("fields.none");
  const text = (value: string | null) => (value ? value : t("fields.none"));
  const topic =
    row.topic === "retainer" || row.topic === "general" ? t(`topics.${row.topic}`) : row.topic;
  const band =
    row.headcount_band === "1-49" ||
    row.headcount_band === "50-249" ||
    row.headcount_band === "250+"
      ? t(`bands.${row.headcount_band}`)
      : text(row.headcount_band);

  const details: ReadonlyArray<readonly [label: string, value: React.ReactNode, mono?: boolean]> = [
    [t("fields.status"), <EnquiryStatusBadge key="status" status={row.status} />],
    [t("fields.topic"), topic],
    [t("fields.company"), row.company_name],
    [t("fields.contact"), row.contact_name],
    [
      t("fields.email"),
      <a key="email" href={`mailto:${row.email}`} className="underline underline-offset-4">
        {row.email}
      </a>,
    ],
    [t("fields.phone"), text(row.phone)],
    [t("fields.headcount"), band],
    [t("fields.language"), languageName(row.locale)],
    [t("fields.organization"), row.organization?.name ?? t("fields.none")],
    [t("fields.handledBy"), text(row.handled_by), true],
    [t("fields.handledAt"), when(row.handled_at)],
    [t("fields.created"), when(row.created_at)],
    [t("fields.updated"), when(row.updated_at)],
    [t("fields.id"), row.id, true],
  ];

  return (
    <PageStack>
      <PageHeader
        title={t("detailTitle")}
        description={`${row.company_name} · ${topic}`}
        breadcrumb={[
          { label: nav("overview"), href: "/admin" },
          { label: nav("enquiries"), href: "/admin/enquiries" },
          { label: row.id.slice(0, 8) },
        ]}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="details-heading" className="flex flex-col gap-3">
          <h2 id="details-heading" className="font-semibold text-lg">
            {t("sections.details")}
          </h2>
          <Card>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_minmax(0,1fr)]">
                {details.map(([label, value, mono]) => (
                  <div key={label} className="contents">
                    <dt className="text-muted-foreground text-xs sm:pt-0.5">{label}</dt>
                    <dd className={mono ? "break-all font-mono text-xs" : "text-sm"}>{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("fields.message")}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="max-w-prose whitespace-pre-wrap text-sm">{row.message}</p>
            </CardContent>
          </Card>
        </section>
        <section aria-labelledby="workflow-heading" className="flex flex-col gap-3">
          <h2 id="workflow-heading" className="font-semibold text-lg">
            {t("sections.workflow")}
          </h2>
          <Card>
            <CardContent>
              <NextIntlClientProvider messages={clientMessages(messages, ["enquiries"])}>
                <EnquiryStatusForm
                  id={row.id}
                  status={isEnquiryStatus(row.status) ? row.status : "new"}
                  opsNote={row.ops_note}
                />
              </NextIntlClientProvider>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageStack>
  );
}
