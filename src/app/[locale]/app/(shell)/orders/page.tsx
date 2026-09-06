import { ReceiptIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
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
import { listOrders } from "@/features/checkout/queries";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata() {
  const t = await getTranslations("orders");
  return { title: t("title") };
}

/**
 * The badge variant per status. Every badge carries its label too, so colour never carries the
 * meaning alone (design.md). The status column is plain text in the database, so an unknown value
 * falls back rather than throwing.
 */
const STATUS_VARIANT: Record<string, "warning" | "success" | "secondary" | "outline"> = {
  pending: "warning",
  paid: "success",
  cancelled: "secondary",
  refunded: "secondary",
  expired: "outline",
};

/**
 * The client's orders (spec 0011, AC-1, AC-6): newest first, keyset paginated, with the expired
 * ones hidden because an abandoned checkout is not something the buyer needs to see again.
 */
export default async function OrdersPage({ searchParams }: Props) {
  const params = await searchParams;
  const cursor = typeof params.cursor === "string" ? params.cursor : null;
  const [t, format, supabase] = await Promise.all([
    getTranslations("orders"),
    getFormatter(),
    createServerSupabaseClient(),
  ]);
  const page = await listOrders(supabase, cursor);

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("description")} />
      {page.orders.length === 0 ? (
        <EmptyState
          icon={ReceiptIcon}
          title={t("emptyTitle")}
          description={t("emptyBody")}
          action={
            <Button asChild>
              <Link href="/app/checkout">{t("emptyAction")}</Link>
            </Button>
          }
        />
      ) : (
        <section className="flex flex-col gap-4">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.reference")}</TableHead>
                <TableHead>{t("columns.package")}</TableHead>
                <TableHead className="text-right">{t("columns.amount")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.date")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>
                    <Link
                      className="font-mono text-xs underline"
                      href={{ pathname: "/app/orders/[id]", params: { id: order.id } }}
                    >
                      {order.reference}
                    </Link>
                  </TableCell>
                  <TableCell>{order.package_name_snapshot}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {format.number(rappenToChf(Number(order.gross_rappen)), "chf")}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[order.status] ?? "secondary"}>
                      {t(`status.${order.status}` as never)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <time dateTime={order.created_at}>
                      {format.dateTime(new Date(order.created_at), "dateShort")}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {page.nextCursor ? (
            <div>
              <Button asChild variant="outline">
                <Link href={{ pathname: "/app/orders", query: { cursor: page.nextCursor } }}>
                  {t("more")}
                </Link>
              </Button>
            </div>
          ) : null}
        </section>
      )}
    </PageStack>
  );
}
