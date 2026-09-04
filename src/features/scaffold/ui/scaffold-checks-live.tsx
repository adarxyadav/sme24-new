"use client";

import { InboxIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ScaffoldCheck } from "@/features/scaffold/queries";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const POLL_MS = 5_000;

function statusVariant(status: string): "success" | "destructive" | "info" {
  if (status === "completed" || status === "ok") return "success";
  if (status === "failed" || status === "error") return "destructive";
  return "info";
}

/**
 * Live list of smoke test rows: Supabase Realtime (RLS enforced per subscriber) with a polling
 * fallback that refreshes the server component when the channel is not healthy (spec 0001).
 */
export function ScaffoldChecksLive({ initialRows }: { initialRows: ScaffoldCheck[] }) {
  const t = useTranslations("scaffold");
  const format = useFormatter();
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [live, setLive] = useState(false);

  useEffect(() => setRows(initialRows), [initialRows]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let cancelled = false;

    const channel = supabase
      .channel("scaffold_checks")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scaffold_checks" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const removed = payload.old as Partial<ScaffoldCheck>;
            setRows((current) => current.filter((row) => row.id !== removed.id));
            return;
          }
          const next = payload.new as ScaffoldCheck;
          setRows((current) => {
            const others = current.filter((row) => row.id !== next.id);
            return [next, ...others].sort((a, b) => b.created_at.localeCompare(a.created_at));
          });
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

  return (
    <section aria-labelledby="checks-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="checks-heading" className="font-semibold text-lg">
          {t("checksTitle")}
        </h2>
        <Badge variant={live ? "success" : "outline"} data-live={live}>
          {live ? t("live") : t("polling")}
        </Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={InboxIcon} title={t("emptyTitle")} description={t("empty")} />
      ) : (
        <div className="rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.message")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.run")}</TableHead>
                <TableHead>{t("columns.time")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.message}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{row.run_id}</TableCell>
                  <TableCell className="tabular-nums" data-numeric>
                    {format.dateTime(new Date(row.created_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
