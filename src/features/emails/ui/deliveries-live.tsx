"use client";

import { InboxIcon, SearchXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
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
import type { Delivery } from "@/features/emails/queries";
import type { DeliveryFilters } from "@/features/emails/schema";
import { Link } from "@/i18n/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { DeliveryStatusBadge } from "./delivery-status-badge";

const POLL_MS = 5_000;

export type DeliveriesLiveProps = {
  readonly initialRows: readonly Delivery[];
  readonly nextCursor: string | null;
  readonly filters: DeliveryFilters;
};

/**
 * The deliveries table (spec 0006, AC-9): Supabase Realtime patches the rows already on the page
 * (the ops SELECT policy is enforced per subscriber), a polling refresh covers the time the
 * channel is not healthy, and the keyset cursor pages older rows. Client component.
 */
export function DeliveriesLive({ initialRows, nextCursor, filters }: DeliveriesLiveProps) {
  const t = useTranslations("emails");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [live, setLive] = useState(false);

  useEffect(() => setRows(initialRows), [initialRows]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let cancelled = false;

    const channel = supabase
      .channel("email_deliveries")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "email_deliveries" },
        (payload) => {
          const next = payload.new as Delivery;
          // Only rows already on this page: paging and filters stay what the server decided.
          setRows((current) => current.map((row) => (row.id === next.id ? next : row)));
        },
      );

    // Realtime authorizes against the subscriber's token: set it before subscribing and on refresh.
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe((status) => {
        if (cancelled) return;
        setLive(status === "SUBSCRIBED");
      });
    });

    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (live) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [live, router]);

  const filtered = Boolean(filters.status || filters.template || filters.q);
  const baseQuery = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.template ? { template: filters.template } : {}),
    ...(filters.q ? { q: filters.q } : {}),
  };

  return (
    <section aria-labelledby="deliveries-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="deliveries-heading" className="font-semibold text-lg">
          {t("listHeading")}
        </h2>
        <Badge variant={live ? "success" : "outline"} data-live={live}>
          {live ? t("live") : t("polling")}
        </Badge>
      </div>
      {rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={SearchXIcon}
            title={t("noResults.title")}
            description={t("noResults.description")}
            action={
              <Button asChild variant="outline">
                <Link href="/admin/emails">{t("filters.reset")}</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={InboxIcon}
            title={t("empty.title")}
            description={t("empty.description")}
          />
        )
      ) : (
        <div className="rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.recipient")}</TableHead>
                <TableHead>{t("columns.template")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.sourceEvent")}</TableHead>
                <TableHead>{t("columns.created")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} data-delivery-id={row.id}>
                  <TableCell>
                    <Link
                      href={{ pathname: "/admin/emails/[id]", params: { id: row.id } }}
                      className="underline underline-offset-4"
                    >
                      {row.recipient_email || t("fields.none")}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.template}</TableCell>
                  <TableCell>
                    <DeliveryStatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.source_event}</TableCell>
                  <TableCell className="tabular-nums" data-numeric>
                    <time dateTime={row.created_at}>
                      {format.dateTime(new Date(row.created_at), "dateTime")}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {nextCursor || filters.cursor ? (
        <nav aria-label={t("listHeading")} className="flex items-center justify-between gap-3">
          {filters.cursor ? (
            <Button asChild variant="ghost">
              <Link href={{ pathname: "/admin/emails", query: baseQuery }}>
                {t("pagination.first")}
              </Link>
            </Button>
          ) : (
            <span />
          )}
          {nextCursor ? (
            <Button asChild variant="outline">
              <Link
                href={{ pathname: "/admin/emails", query: { ...baseQuery, cursor: nextCursor } }}
              >
                {t("pagination.next")}
              </Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </section>
  );
}
