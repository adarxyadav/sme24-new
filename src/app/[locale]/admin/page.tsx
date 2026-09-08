import {
  Building2Icon,
  CalendarClockIcon,
  CheckCircle2Icon,
  InboxIcon,
  MailWarningIcon,
  ReceiptIcon,
  SearchXIcon,
  UsersIcon,
} from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { listOpsCounts, listOpsQueue } from "@/features/ops-admin/queries";
import { Link } from "@/i18n/navigation";
import type { StaticPathname } from "@/i18n/pathnames";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The ops home (spec 0014, AC-11): the work waiting on ops as five queue sections, then the counts
 * for companies, open research, orders by status and active experts, each linking into its own
 * list. Every read is one query with the caller's own client, so the ops policies stay the
 * boundary. Ops only, through the proxy and the ops policy.
 */
export default async function AdminPage() {
  const [t, orderStatus, areas, format, supabase] = await Promise.all([
    getTranslations("adminOverview"),
    getTranslations("orders.status"),
    getTranslations("areas.admin"),
    getFormatter(),
    createServerSupabaseClient(),
  ]);
  // Independent of each other, so the tiles never wait on the queue.
  const [queue, counts] = await Promise.all([listOpsQueue(supabase), listOpsCounts(supabase)]);

  const date = (at: string) => format.dateTime(new Date(at), "dateShort");
  const isQueueEmpty =
    queue.unscheduledOrders.length === 0 &&
    queue.overdueOrders.length === 0 &&
    queue.newEnquiries.length === 0 &&
    queue.failedDeliveries.length === 0 &&
    queue.failedRuns.length === 0;

  return (
    <PageStack>
      <PageHeader title={areas("title")} description={t("lead")} />

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold text-lg">{t("queue")}</h2>
        {isQueueEmpty ? (
          <EmptyState
            icon={CheckCircle2Icon}
            title={t("queueEmptyTitle")}
            description={t("queueEmptyBody")}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <QueueSection
              title={t("sections.unscheduledOrders")}
              icon={ReceiptIcon}
              count={queue.unscheduledOrders.length}
              href="/admin/orders"
              linkLabel={t("viewAll")}
              items={queue.unscheduledOrders.map((order) => ({
                key: order.id,
                primary: `${order.reference} · ${order.organizationName}`,
                secondary: order.paidAt
                  ? t("paidOn", { date: date(order.paidAt) })
                  : t("neverPaid"),
              }))}
            />
            <QueueSection
              title={t("sections.overdueOrders")}
              icon={CalendarClockIcon}
              count={queue.overdueOrders.length}
              href="/admin/orders"
              linkLabel={t("viewAll")}
              items={queue.overdueOrders.map((order) => ({
                key: order.id,
                primary: `${order.reference} · ${order.organizationName}`,
                secondary: t("dueOn", { date: date(order.scheduledAt) }),
                badge: orderStatus(order.status as "scheduled"),
              }))}
            />
            <QueueSection
              title={t("sections.newEnquiries")}
              icon={InboxIcon}
              count={queue.newEnquiries.length}
              href="/admin/enquiries"
              linkLabel={t("viewAll")}
              items={queue.newEnquiries.map((enquiry) => ({
                key: enquiry.id,
                primary: enquiry.companyName ?? t("unnamed"),
                secondary: t("receivedOn", { date: date(enquiry.createdAt) }),
              }))}
            />
            <QueueSection
              title={t("sections.failedDeliveries")}
              icon={MailWarningIcon}
              count={queue.failedDeliveries.length}
              href="/admin/emails"
              linkLabel={t("viewAll")}
              items={queue.failedDeliveries.map((delivery) => ({
                key: delivery.id,
                primary: delivery.template,
                secondary: date(delivery.createdAt),
                badge: delivery.status,
              }))}
            />
            <QueueSection
              title={t("sections.failedRuns")}
              icon={SearchXIcon}
              count={queue.failedRuns.length}
              href="/admin/companies"
              linkLabel={t("viewAll")}
              items={queue.failedRuns.map((run) => ({
                key: run.id,
                primary: run.companyName,
                secondary: date(run.createdAt),
                badge: run.errorCode ?? t("noErrorCode"),
              }))}
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-semibold text-lg">{t("counts")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <CountTile
            title={t("tiles.companies")}
            icon={Building2Icon}
            value={format.number(counts.companies, "integer")}
            href="/admin/companies"
          />
          <CountTile
            title={t("tiles.openResearchRuns")}
            icon={SearchXIcon}
            value={format.number(counts.openResearchRuns, "integer")}
            href="/admin/companies"
          />
          <CountTile
            title={t("tiles.activeExperts")}
            icon={UsersIcon}
            value={format.number(counts.activeExperts, "integer")}
            href="/admin/experts"
          />
          <CountTile
            title={t("tiles.orders")}
            icon={ReceiptIcon}
            value={format.number(
              [...counts.ordersByStatus.values()].reduce((total, count) => total + count, 0),
              "integer",
            )}
            href="/admin/orders"
          >
            {counts.ordersByStatus.size === 0 ? (
              <p className="text-muted-foreground text-sm">{t("noOrders")}</p>
            ) : (
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                {[...counts.ordersByStatus.entries()].map(([status, count]) => (
                  <div key={status} className="flex items-baseline gap-1.5">
                    <dt className="text-muted-foreground text-sm">
                      {orderStatus(status as "paid")}
                    </dt>
                    <dd className="font-medium text-sm tabular-nums">
                      {format.number(count, "integer")}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </CountTile>
        </div>
      </section>
    </PageStack>
  );
}

/** One row of a queue section: what it is, when, and optionally the state it is stuck in. */
type QueueItem = {
  readonly key: string;
  readonly primary: string;
  readonly secondary: string;
  readonly badge?: string;
};

type QueueSectionProps = {
  readonly title: string;
  readonly icon: typeof ReceiptIcon;
  readonly count: number;
  readonly href: StaticPathname;
  readonly linkLabel: string;
  readonly items: readonly QueueItem[];
};

/**
 * One block of the ops queue: its heading with the number waiting, up to ten rows and the link
 * into the list that holds the rest. A section with nothing waiting renders nothing at all, so the
 * queue shows only what actually needs ops. Server component.
 */
function QueueSection({ title, icon: Icon, count, href, linkLabel, items }: QueueSectionProps) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
          <Badge variant="secondary" className="tabular-nums">
            {count}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-col divide-y">
          {items.map((item) => (
            <li key={item.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-2">
              <span className="font-medium text-sm">{item.primary}</span>
              {item.badge ? <Badge variant="outline">{item.badge}</Badge> : null}
              <span className="ml-auto text-muted-foreground text-xs">{item.secondary}</span>
            </li>
          ))}
        </ul>
        <Link href={href} className="text-sm underline underline-offset-4">
          {linkLabel}
        </Link>
      </CardContent>
    </Card>
  );
}

type CountTileProps = {
  readonly title: string;
  readonly icon: typeof ReceiptIcon;
  readonly value: string;
  readonly href: StaticPathname;
  readonly children?: ReactNode;
};

/**
 * One count tile: a figure, its label and the list it links into. The whole tile is the link
 * target, carried by the heading so the link's accessible name is the tile's label alone; a tile
 * with a breakdown renders it below the figure. Server component.
 */
function CountTile({ title, icon: Icon, value, href, children }: CountTileProps) {
  return (
    <Card className="relative h-full transition-colors hover:border-primary/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-medium text-muted-foreground text-sm">
          <Icon className="size-4" aria-hidden="true" />
          <Link
            href={href}
            className="after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {title}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="font-semibold text-3xl tabular-nums">{value}</p>
        {children}
      </CardContent>
    </Card>
  );
}
