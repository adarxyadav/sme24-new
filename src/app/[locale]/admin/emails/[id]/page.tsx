import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDelivery } from "@/features/emails/queries";
import { DeliveryPreview } from "@/features/emails/ui/delivery-preview";
import { DeliveryStatusBadge } from "@/features/emails/ui/delivery-status-badge";
import { RetryButton } from "@/features/emails/ui/retry-button";
import { clientMessages } from "@/i18n/client-messages";
import { renderDeliveryPreview } from "@/lib/email/render";
import { clientEnv } from "@/lib/env";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly params: Promise<{ readonly id: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("emails");
  return { title: t("detailTitle") };
}

/** One delivery (spec 0006, AC-9, AC-10): every column, the error, the rerendered preview, retry on a failed row. Ops only. */
export default async function AdminEmailDetailPage({ params }: Props) {
  const { id } = await params;
  const [t, nav, format, supabase, messages] = await Promise.all([
    getTranslations("emails"),
    getTranslations("nav.admin"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const row = await getDelivery(supabase, id);
  const preview = await renderDeliveryPreview(row, clientEnv().NEXT_PUBLIC_APP_URL);

  const when = (value: string | null) =>
    value ? format.dateTime(new Date(value), "dateTime") : t("fields.none");
  const text = (value: string | number | null) =>
    value === null || value === "" ? t("fields.none") : String(value);

  const details: ReadonlyArray<readonly [label: string, value: React.ReactNode, mono?: boolean]> = [
    [t("fields.status"), <DeliveryStatusBadge key="status" status={row.status} />],
    [t("fields.recipient"), text(row.recipient_email)],
    [t("fields.subject"), text(row.subject)],
    [t("fields.template"), row.template, true],
    [t("fields.locale"), row.locale, true],
    [t("fields.sourceEvent"), row.source_event, true],
    [t("fields.transport"), text(row.transport), true],
    [t("fields.error"), text(row.error)],
    [t("fields.attempts"), String(row.attempts)],
    [t("fields.created"), when(row.created_at)],
    [t("fields.sent"), when(row.sent_at)],
    [t("fields.delivered"), when(row.delivered_at)],
    [t("fields.failed"), when(row.failed_at)],
    [t("fields.updated"), when(row.updated_at)],
    [t("fields.id"), row.id, true],
    [t("fields.idempotencyKey"), row.idempotency_key, true],
    [t("fields.providerMessageId"), text(row.provider_message_id), true],
    [t("fields.lastRunId"), text(row.last_run_id), true],
    [t("fields.recipientId"), text(row.recipient_id), true],
    [t("fields.organization"), text(row.organization_id), true],
  ];

  return (
    <PageStack>
      <NextIntlClientProvider messages={clientMessages(messages, ["emails"])}>
        <PageHeader
          title={t("detailTitle")}
          description={row.subject ?? row.recipient_email}
          breadcrumb={[
            { label: nav("overview"), href: "/admin" },
            { label: nav("emails"), href: "/admin/emails" },
            { label: row.id.slice(0, 8) },
          ]}
          actions={row.status === "failed" ? <RetryButton deliveryId={row.id} /> : undefined}
        />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
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
                <CardTitle>{t("sections.data")}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto font-mono text-xs">
                  {JSON.stringify(row.data, null, 2)}
                </pre>
              </CardContent>
            </Card>
          </section>
          <section aria-labelledby="preview-heading" className="flex flex-col gap-3">
            <h2 id="preview-heading" className="font-semibold text-lg">
              {t("sections.preview")}
            </h2>
            <DeliveryPreview preview={preview} />
          </section>
        </div>
      </NextIntlClientProvider>
    </PageStack>
  );
}
