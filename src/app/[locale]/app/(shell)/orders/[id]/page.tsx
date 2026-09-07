import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { rappenToChf } from "@/features/checkout/money";
import { getOrder } from "@/features/checkout/queries";
import { ConfirmingPayment } from "@/features/checkout/ui/confirming-payment";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = { readonly params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const [{ id }, t] = await Promise.all([params, getTranslations("orders")]);
  return { title: t("detailTitle", { reference: id.slice(0, 8) }) };
}

/**
 * One order (spec 0011, AC-1, AC-5, AC-6, AC-8). This page doubles as the Stripe return page: the
 * checkout action sets Stripe's `success_url` to it, so coming back is a normal read of a row the
 * client already owns and the `session_id` Stripe appends is ignored entirely. The page never
 * writes.
 *
 * Another organization's order is a 404, never a 403, which would confirm the row exists (AC-12).
 */
export default async function OrderPage({ params }: Props) {
  const [{ id }, t, format, supabase, messages] = await Promise.all([
    params,
    getTranslations("orders"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);

  const found = await getOrder(supabase, id);
  if (!found) notFound();
  const { order, invoice } = found;

  const chf = (rappen: number | string) => format.number(rappenToChf(Number(rappen)), "chf");
  // A pending card order whose session exists is mid payment: the webhook has not landed yet.
  const confirming =
    order.status === "pending" &&
    order.payment_method === "card" &&
    Boolean(order.stripe_checkout_session_id);
  const awaitingTransfer = order.status === "pending" && order.payment_method === "bank_transfer";

  return (
    <PageStack>
      <PageHeader
        title={t("detailTitle", { reference: order.reference })}
        description={order.package_name_snapshot}
        actions={
          <Button asChild variant="outline">
            <Link href="/app/orders">
              <ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />
              {t("backToList")}
            </Link>
          </Button>
        }
      />

      {confirming ? (
        <NextIntlClientProvider messages={clientMessages(messages, ["orders"])}>
          <ConfirmingPayment />
        </NextIntlClientProvider>
      ) : null}

      {awaitingTransfer ? (
        <Alert>
          <AlertTitle>{t("awaitingTransferTitle")}</AlertTitle>
          <AlertDescription>
            {t("awaitingTransferBody", {
              dueDate: order.due_date ? format.dateTime(new Date(order.due_date), "dateLong") : "—",
            })}
          </AlertDescription>
        </Alert>
      ) : null}

      {order.status === "paid" ? (
        <Alert variant="success">
          <AlertTitle>{t("paidTitle")}</AlertTitle>
          <AlertDescription>{t("paidBody")}</AlertDescription>
        </Alert>
      ) : null}

      {order.status === "expired" ? (
        <Alert variant="warning">
          <AlertTitle>{t("expiredTitle")}</AlertTitle>
          <AlertDescription>{t("expiredBody")}</AlertDescription>
        </Alert>
      ) : null}

      {order.status === "cancelled" ? (
        <Alert>
          <AlertTitle>{t("cancelledTitle")}</AlertTitle>
          <AlertDescription>{t("cancelledBody")}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="amount" className="border bg-card p-6">
        <h2 id="amount" className="text-base font-semibold">
          {t("summaryTitle")}
        </h2>
        <dl className="mt-4 flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">{t("net")}</dt>
            <dd className="tabular-nums">{chf(order.net_rappen)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">
              {t("vat", { rate: format.number(Number(order.vat_rate), "percent") })}
            </dt>
            <dd className="tabular-nums">{chf(order.vat_rappen)}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
            <dt>{t("gross")}</dt>
            <dd className="tabular-nums">{chf(order.gross_rappen)}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="billing" className="border bg-card p-6">
        <h2 id="billing" className="text-base font-semibold">
          {t("billingTitle")}
        </h2>
        <address className="mt-4 text-sm not-italic text-muted-foreground">
          {order.billing_name}
          <br />
          {order.billing_street}
          <br />
          {order.billing_postcode} {order.billing_town}
          <br />
          {order.billing_country}
          {order.billing_uid ? (
            <>
              <br />
              <span className="font-mono text-xs">{order.billing_uid}</span>
            </>
          ) : null}
        </address>
      </section>

      {invoice ? (
        <section aria-labelledby="invoice" className="border bg-card p-6">
          <h2 id="invoice" className="text-base font-semibold">
            {t("invoiceTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("invoiceNumber", { number: invoice.number })}
          </p>
          <div className="mt-4">
            {invoice.pdf_path ? (
              <Button asChild variant="outline">
                <a href={`/api/orders/${order.id}/invoice`}>
                  <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                  {t("invoiceDownload")}
                </a>
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {invoice.pdf_failed_at ? t("invoiceFailed") : t("invoicePending")}
              </p>
            )}
          </div>
        </section>
      ) : null}
    </PageStack>
  );
}
