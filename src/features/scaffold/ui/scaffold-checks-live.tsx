"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { ScaffoldCheck } from "@/features/scaffold/queries";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";

const POLL_MS = 5_000;

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
        <h2 id="checks-heading" className="text-lg font-semibold">
          {t("checksTitle")}
        </h2>
        <span className="text-xs text-muted-foreground" data-live={live}>
          {live ? "realtime" : "polling"}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("columns.message")}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("columns.status")}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("columns.run")}
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  {t("columns.time")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-2">{row.message}</td>
                  <td className="px-4 py-2">{row.status}</td>
                  <td className="px-4 py-2 font-mono text-xs">{row.run_id}</td>
                  <td className="px-4 py-2">
                    {format.dateTime(new Date(row.created_at), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
