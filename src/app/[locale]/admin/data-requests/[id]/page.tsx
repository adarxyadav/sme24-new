import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent } from "@/components/ui/card";
import { getDataRequest } from "@/features/legal/queries";
import type { DataRequestKind, DataRequestStatus } from "@/features/legal/schema";
import { DATA_REQUEST_KINDS, DATA_REQUEST_STATUSES } from "@/features/legal/schema";
import { DataRequestForm } from "@/features/legal/ui/data-request-form";
import { DataRequestStatusBadge } from "@/features/legal/ui/data-requests-table";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("adminDataRequests");
  return { title: t("detail.title") };
}

/**
 * One data request (spec 0015, AC-14, AC-15): who filed it, which right, when it was filed, when
 * it must be answered by, who has handled it so far, and the workflow form beside it. Ops only
 * through the proxy and RLS; an unknown id renders the not found page.
 */
export default async function AdminDataRequestDetailPage({ params }: Props) {
  const { id } = await params;
  const [t, nav, format, supabase, messages] = await Promise.all([
    getTranslations("adminDataRequests"),
    getTranslations("nav.admin"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const row = await getDataRequest(supabase, id);
  if (!row) notFound();

  // The two columns come back as `text`, so they are narrowed here rather than asserted: a value
  // the app has never heard of falls back rather than crashing the page ops need most.
  const kind: DataRequestKind = isKind(row.kind) ? row.kind : "export";
  const status: DataRequestStatus = isStatus(row.status) ? row.status : "new";
  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), "dateTime") : t("detail.notHandled");

  const details: ReadonlyArray<readonly [label: string, value: React.ReactNode, mono?: boolean]> = [
    [t("columns.status"), <DataRequestStatusBadge key="status" status={status} />],
    [t("detail.kind"), t(`kinds.${kind}`)],
    [t("detail.subject"), row.subject?.full_name ?? t("noName")],
    [t("detail.organization"), row.organization?.name ?? t("noOrganization")],
    [t("detail.filed"), when(row.created_at)],
    [t("detail.due"), when(row.due_at)],
    [t("detail.handledBy"), row.handled_by ?? t("detail.notHandled"), true],
    [t("detail.handledAt"), when(row.handled_at)],
    [t("columns.subject"), row.requested_by ?? t("noName"), true],
  ];

  return (
    <PageStack>
      <PageHeader
        title={t("detail.title")}
        description={`${t(`kinds.${kind}`)} · ${t(`status.${status}`)}`}
        breadcrumb={[
          { label: nav("overview"), href: "/admin" },
          { label: nav("dataRequests"), href: "/admin/data-requests" },
          { label: row.id.slice(0, 8) },
        ]}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="details-heading" className="flex flex-col gap-3">
          <h2 id="details-heading" className="font-semibold text-lg">
            {t("detail.title")}
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
        </section>
        <section aria-labelledby="workflow-heading" className="flex flex-col gap-3">
          <h2 id="workflow-heading" className="font-semibold text-lg">
            {t("form.status")}
          </h2>
          <Card>
            <CardContent>
              <NextIntlClientProvider messages={clientMessages(messages, ["adminDataRequests"])}>
                <DataRequestForm id={row.id} kind={kind} status={status} opsNote={row.ops_note} />
              </NextIntlClientProvider>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageStack>
  );
}

function isKind(value: string): value is DataRequestKind {
  return (DATA_REQUEST_KINDS as readonly string[]).includes(value);
}

function isStatus(value: string): value is DataRequestStatus {
  return (DATA_REQUEST_STATUSES as readonly string[]).includes(value);
}
