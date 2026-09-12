import { ArrowLeftIcon, CoinsIcon, DownloadIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { computeAmounts, rappenToChf } from "@/features/checkout/money";
import { getOrder, getPackage } from "@/features/checkout/queries";
import { ConfirmingPayment } from "@/features/checkout/ui/confirming-payment";
import { CREDIT_PACK_KEYS, CREDIT_PRICE_RAPPEN } from "@/features/directory/catalogue";
import { getCreditBalance } from "@/features/directory/queries";
import { CreditsForm } from "@/features/directory/ui/credits-form";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { isUuid } from "@/lib/supabase/cursor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("directory.credits");
  return { title: t("title") };
}

/** The one pack on sale today (owner decision, 2026-09-12: one pack of 50 to start). */
const PACK_KEY = CREDIT_PACK_KEYS[0];

/**
 * The credit pack purchase and its return page (spec 0018, AC-9): the pack, the billing form
 * with the two payment methods, and, with `?order=<id>`, the state of the order the buyer just
 * placed. The return is a normal read of a row the expert owns under RLS and the page never
 * writes it: a card order still pending polls until the webhook lands, a bank transfer order
 * shows the invoice to download. Server component, expert only through the shell gate.
 */
export default async function DirectoryCreditsPage({ searchParams }: Props) {
  const params = await searchParams;
  const orderId = typeof params.order === "string" && isUuid(params.order) ? params.order : null;
  const [t, format, supabase, messages] = await Promise.all([
    getTranslations("directory.credits"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const packNames = await getTranslations("directory.packs");
  const [balance, pack, found, profile] = await Promise.all([
    getCreditBalance(supabase),
    getPackage(supabase, PACK_KEY),
    orderId ? getOrder(supabase, orderId) : null,
    supabase.from("profiles").select("full_name").maybeSingle(),
  ]);
  const chf = (rappen: number | string) => format.number(rappenToChf(Number(rappen)), "chf");
  const amounts =
    pack?.price_rappen !== null && pack !== null
      ? computeAmounts(Number(pack.price_rappen), Number(pack.vat_rate))
      : null;

  const order = found?.order ?? null;
  const invoice = found?.invoice ?? null;
  const confirming =
    order?.status === "pending" &&
    order.payment_method === "card" &&
    Boolean(order.stripe_checkout_session_id);
  const awaitingTransfer = order?.status === "pending" && order.payment_method === "bank_transfer";

  return (
    <PageStack>
      <PageHeader
        title={t("title")}
        description={t("lead")}
        breadcrumb={[{ label: t("back"), href: "/expert/directory" }, { label: t("title") }]}
        actions={
          <>
            <span className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm tabular-nums">
              <CoinsIcon aria-hidden="true" className="size-4 text-muted-foreground" />
              {t("balance")}: {balance}
            </span>
            <Button asChild variant="outline">
              <Link href="/expert/directory">
                <ArrowLeftIcon aria-hidden="true" data-icon="inline-start" />
                {t("back")}
              </Link>
            </Button>
          </>
        }
      />

      {confirming ? (
        <NextIntlClientProvider messages={clientMessages(messages, ["orders"])}>
          <ConfirmingPayment />
        </NextIntlClientProvider>
      ) : null}

      {order?.status === "paid" ? (
        <Alert variant="success">
          <AlertTitle>{t("return.paidTitle")}</AlertTitle>
          <AlertDescription>
            <p>{t("return.paidBody", { count: order.credits ?? 0, balance })}</p>
            <Button asChild size="sm" className="mt-2">
              <Link href="/expert/directory">{t("return.paidAction")}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {awaitingTransfer && order ? (
        <Alert>
          <AlertTitle>{t("return.awaitingTitle")}</AlertTitle>
          <AlertDescription>
            <p>
              {t("return.awaitingBody", {
                dueDate: order.due_date
                  ? format.dateTime(new Date(order.due_date), "dateLong")
                  : "—",
              })}
            </p>
            <div className="mt-2">
              {invoice?.pdf_path ? (
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/orders/${order.id}/invoice`}>
                    <DownloadIcon data-icon="inline-start" aria-hidden="true" />
                    {t("return.invoiceDownload")}
                  </a>
                </Button>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {invoice?.pdf_failed_at ? t("return.invoiceFailed") : t("return.invoicePending")}
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {order?.status === "expired" ? (
        <Alert variant="warning">
          <AlertTitle>{t("return.expiredTitle")}</AlertTitle>
          <AlertDescription>{t("return.expiredBody")}</AlertDescription>
        </Alert>
      ) : null}
      {order?.status === "cancelled" ? (
        <Alert>
          <AlertTitle>{t("return.cancelledTitle")}</AlertTitle>
          <AlertDescription>{t("return.cancelledBody")}</AlertDescription>
        </Alert>
      ) : null}

      {pack && amounts ? (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
          <section
            aria-labelledby="pack-heading"
            className="flex flex-col gap-4 border bg-card p-6"
          >
            <h2 id="pack-heading" className="font-semibold text-lg">
              {t("pack.heading")}
            </h2>
            <p className="font-semibold text-2xl tracking-headline">
              {packNames(`${PACK_KEY}.name` as never)}
            </p>
            <p className="text-muted-foreground text-sm">
              {packNames(`${PACK_KEY}.description` as never)}
            </p>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("pack.credits", { count: pack.credits ?? 0 })}
                </dt>
                <dd className="tabular-nums">
                  {t("pack.unit", { price: chf(CREDIT_PRICE_RAPPEN) })}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{t("net")}</dt>
                <dd className="tabular-nums">{chf(amounts.netRappen)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("vat", { rate: format.number(amounts.vatRate, "percent") })}
                </dt>
                <dd className="tabular-nums">{chf(amounts.vatRappen)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
                <dt>{t("gross")}</dt>
                <dd className="tabular-nums">{chf(amounts.grossRappen)}</dd>
              </div>
            </dl>
            <p className="text-muted-foreground text-xs">{t("pack.note")}</p>
          </section>

          <NextIntlClientProvider messages={clientMessages(messages, ["directory", "checkout"])}>
            <div className="max-w-2xl">
              <CreditsForm packKey={PACK_KEY} billingName={profile.data?.full_name ?? ""} />
            </div>
          </NextIntlClientProvider>
        </div>
      ) : (
        <Alert variant="warning">
          <AlertTitle>{t("unavailableTitle")}</AlertTitle>
          <AlertDescription>{t("unavailableBody")}</AlertDescription>
        </Alert>
      )}
    </PageStack>
  );
}
