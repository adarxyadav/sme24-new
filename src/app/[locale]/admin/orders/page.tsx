import { ReceiptIcon } from "lucide-react";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { rappenToChf } from "@/features/checkout/money";
import { listAllOrders } from "@/features/checkout/queries";
import { OrderActions } from "@/features/checkout/ui/order-actions";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("adminOrders");
  return { title: t("title") };
}

/** The badge variant per status; every badge carries its label, so colour is never alone. */
const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary" | "outline"> = {
  pending: "warning",
  paid: "success",
  cancelled: "secondary",
  refunded: "secondary",
  expired: "outline",
};

/**
 * The ops orders list (spec 0011, AC-9, AC-10): every order with its client, what it cost, its
 * invoice and the controls to confirm a bank transfer, cancel a stale order or retry a render
 * that gave up. The full ops shell is feature 12; this is the minimal list that spec asks for.
 * Ops only, through the proxy and the ops policy.
 */
export default async function AdminOrdersPage({ searchParams }: Props) {
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const [t, orders, format, supabase, messages] = await Promise.all([
    getTranslations("adminOrders"),
    getTranslations("orders"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const page = await listAllOrders(supabase, cursor);

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("description")} />
      {page.rows.length === 0 ? (
        <EmptyState icon={ReceiptIcon} title={t("emptyTitle")} description={t("emptyBody")} />
      ) : (
        <NextIntlClientProvider messages={clientMessages(messages, ["adminOrders"])}>
          <section className="flex flex-col gap-4">
            <div className="overflow-x-auto">
              <Table density="compact">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("columns.reference")}</TableHead>
                    <TableHead>{t("columns.organization")}</TableHead>
                    <TableHead>{t("columns.package")}</TableHead>
                    <TableHead className="text-right">{t("columns.amount")}</TableHead>
                    <TableHead>{t("columns.method")}</TableHead>
                    <TableHead>{t("columns.status")}</TableHead>
                    <TableHead>{t("columns.invoice")}</TableHead>
                    <TableHead>{t("columns.date")}</TableHead>
                    <TableHead>{t("columns.actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.rows.map(({ order, organizationName, invoice }) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">{order.reference}</TableCell>
                      <TableCell>{organizationName}</TableCell>
                      <TableCell>{order.package_name_snapshot}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {format.number(rappenToChf(Number(order.gross_rappen)), "chf")}
                      </TableCell>
                      <TableCell>{t(`method.${order.payment_method}` as never)}</TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[order.status] ?? "secondary"}>
                          {orders(`status.${order.status}` as never)}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {invoice
                          ? invoice.pdf_path
                            ? invoice.number
                            : invoice.pdf_failed_at
                              ? t("invoiceFailed")
                              : t("invoicePending")
                          : t("noInvoice")}
                      </TableCell>
                      <TableCell>
                        <time dateTime={order.created_at}>
                          {format.dateTime(new Date(order.created_at), "dateShort")}
                        </time>
                      </TableCell>
                      <TableCell>
                        <OrderActions
                          orderId={order.id}
                          reference={order.reference}
                          status={order.status}
                          invoiceId={invoice?.id ?? null}
                          renderFailed={Boolean(invoice?.pdf_failed_at && !invoice.pdf_path)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {page.nextCursor ? (
              <div>
                <Button asChild variant="outline">
                  <Link href={{ pathname: "/admin/orders", query: { cursor: page.nextCursor } }}>
                    {orders("more")}
                  </Link>
                </Button>
              </div>
            ) : null}
          </section>
        </NextIntlClientProvider>
      )}
    </PageStack>
  );
}
