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
import { expertNames, listAssignableExperts } from "@/features/ops-admin/queries";
import { formatZurichWallClock } from "@/features/ops-admin/schema";
import { DeliveryActions } from "@/features/ops-admin/ui/delivery-actions";
import { ScheduleDialog } from "@/features/ops-admin/ui/schedule-dialog";
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
const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary" | "outline" | "info"> = {
  pending: "warning",
  paid: "success",
  cancelled: "secondary",
  refunded: "secondary",
  expired: "outline",
  scheduled: "info",
  in_progress: "info",
  delivered: "success",
};

/**
 * The ops orders list (spec 0011, AC-9, AC-10): every order with its client, what it cost, its
 * invoice and the controls to confirm a bank transfer, cancel a stale order or retry a render
 * that gave up. Spec 0014 (AC-3) adds the delivery column: a paid order carries the scheduling
 * dialog, and a booked one shows its date and assessor.
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
  // Both reads are for the delivery column: the picker's options, and the names behind the ids
  // this page of orders already carries. The experts list is fetched whatever the page holds,
  // because the dialog is rendered per paid row rather than once.
  const [assignableExperts, scheduledNames] = await Promise.all([
    listAssignableExperts(supabase),
    expertNames(
      supabase,
      page.rows.flatMap(({ order }) =>
        order.assigned_expert_id ? [order.assigned_expert_id] : [],
      ),
    ),
  ]);

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
                    <TableHead>{t("columns.delivery")}</TableHead>
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
                        {order.scheduled_at ? (
                          <div className="flex flex-col gap-0.5">
                            <time className="text-sm" dateTime={order.scheduled_at}>
                              {format.dateTime(new Date(order.scheduled_at), "dateTime")}
                            </time>
                            <span className="text-muted-foreground text-xs">
                              {(order.assigned_expert_id
                                ? scheduledNames.get(order.assigned_expert_id)
                                : null) ?? t("schedule.unnamed")}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">{t("notScheduled")}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-2">
                          {order.status === "paid" ? (
                            <ScheduleDialog
                              orderId={order.id}
                              reference={order.reference}
                              experts={assignableExperts}
                            />
                          ) : null}
                          <DeliveryActions
                            orderId={order.id}
                            reference={order.reference}
                            status={order.status}
                            scheduledAt={
                              order.scheduled_at
                                ? formatZurichWallClock(new Date(order.scheduled_at))
                                : null
                            }
                            assignedExpertId={order.assigned_expert_id}
                            experts={assignableExperts}
                          />
                          <OrderActions
                            orderId={order.id}
                            reference={order.reference}
                            status={order.status}
                            invoiceId={invoice?.id ?? null}
                            renderFailed={Boolean(invoice?.pdf_failed_at && !invoice.pdf_path)}
                          />
                        </div>
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
