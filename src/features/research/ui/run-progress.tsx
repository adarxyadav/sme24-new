"use client";

import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { type ProgressItem, ProgressList } from "@/components/ui/progress-list";
import type { BenchmarkState } from "@/features/benchmark/catalogue";
import { RUN_LIMIT_PER_DAY, RUN_STEPS, type RunStep } from "@/features/research/catalogue";
import { parseSummary, type ResearchSummary } from "@/features/research/summary";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/database.types";
import { RunStatusBadge } from "./badges";

type RunRow = Tables<"research_runs">;

const POLL_MS = 5_000;
const TERMINAL = new Set(["succeeded", "empty", "failed"]);

export type RunProgressProps = {
  readonly run: Pick<
    RunRow,
    "id" | "status" | "summary" | "created_at" | "started_at" | "finished_at" | "error_code"
  >;
  readonly quota: { readonly remaining: number; readonly limit: number };
  /** The company whose snapshot inserts refresh the page (spec 0008, AC-12). */
  readonly companyId: string;
  readonly benchmarkState: BenchmarkState;
};

/** The state of each of the five steps for a run (AC-7). Pure. */
export function stepItems(
  status: string,
  summary: ResearchSummary | null,
  labels: (step: RunStep) => string,
  failedDetail: string | null,
): readonly ProgressItem[] {
  const current: RunStep = status === "queued" ? "queued" : (summary?.step ?? "searching");
  const terminal = TERMINAL.has(status);
  const currentIndex = terminal ? RUN_STEPS.length : RUN_STEPS.indexOf(current);
  return RUN_STEPS.map((step, index) => {
    if (status === "failed" && index === Math.min(currentIndex, RUN_STEPS.length - 1)) {
      return { id: step, label: labels(step), state: "failed", detail: failedDetail ?? undefined };
    }
    if (terminal || index < currentIndex) return { id: step, label: labels(step), state: "done" };
    if (index === currentIndex) return { id: step, label: labels(step), state: "current" };
    return { id: step, label: labels(step), state: "pending" };
  });
}

/**
 * The live progress of the latest run (spec 0007, AC-7): subscribes to the run's row over
 * Supabase Realtime (re keyed when the id changes after a rerun), refreshes the page every five
 * seconds while the run is open as the fallback, and once more when the status turns terminal so
 * the table renders on the server. A second channel follows `benchmark_snapshots` inserts for the
 * company and refreshes on each, and the poll also runs while the benchmark is `calculating`
 * (spec 0008, AC-12). Browser.
 */
export function RunProgress({
  run: initialRun,
  quota,
  companyId,
  benchmarkState,
}: RunProgressProps) {
  const t = useTranslations("research");
  const format = useFormatter();
  const router = useRouter();
  const [run, setRun] = useState(initialRun);
  const [live, setLive] = useState(false);

  useEffect(() => setRun(initialRun), [initialRun]);

  const open = !TERMINAL.has(run.status);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let cancelled = false;
    const channel = supabase.channel(`research_run:${initialRun.id}`).on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "research_runs",
        filter: `id=eq.${initialRun.id}`,
      },
      (payload) => {
        const next = payload.new as RunRow;
        setRun(next);
        if (TERMINAL.has(next.status)) router.refresh();
      },
    );
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe((status) => {
        if (!cancelled) setLive(status === "SUBSCRIBED");
      });
    });
    return () => {
      cancelled = true;
      authListener.subscription.unsubscribe();
      supabase.removeChannel(channel);
    };
  }, [initialRun.id, router]);

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    let cancelled = false;
    const channel = supabase.channel(`benchmark_snapshots:${companyId}`).on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "benchmark_snapshots",
        filter: `company_id=eq.${companyId}`,
      },
      () => router.refresh(),
    );
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      channel.subscribe();
    });
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [companyId, router]);

  const polling = open || benchmarkState === "calculating";

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [polling, router]);

  const summary = useMemo(() => parseSummary(run.summary), [run.summary]);
  const failedDetail =
    run.status === "failed" && run.error_code
      ? t(`errors.${run.error_code as "internal"}`, { limit: RUN_LIMIT_PER_DAY })
      : null;
  const items = stepItems(run.status, summary, (step) => t(`steps.${step}`), failedDetail);
  const time = (value: string | null) =>
    value ? format.dateTime(new Date(value), "dateTime") : "";

  return (
    <div className="flex flex-col gap-6" data-run-id={run.id} data-run-status={run.status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <RunStatusBadge status={run.status} />
          {open ? (
            <Badge variant={live ? "success" : "outline"} data-live={live}>
              {live ? t("progress.live") : t("progress.polling")}
            </Badge>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs" data-quota-remaining={quota.remaining}>
          {t("progress.quotaLeft", { remaining: quota.remaining, limit: quota.limit })}
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ProgressList
          items={items}
          stepLabel={(index) => t("progress.stepLabel", { step: index + 1 })}
          aria-label={t("progress.heading")}
        />
        <div className="flex flex-col gap-3 text-sm">
          <dl className="flex flex-col gap-3" aria-live="polite">
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow text-muted-foreground">{t("table.sources")}</dt>
              <dd
                className="tabular-nums"
                data-numeric
                data-sources-found={summary?.sourcesFound ?? 0}
              >
                {t("progress.sourcesFound", { count: summary?.sourcesFound ?? 0 })}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="eyebrow text-muted-foreground">{t("table.heading")}</dt>
              <dd className="tabular-nums" data-numeric>
                {t("progress.kpisExtracted", { count: summary?.kpisExtracted ?? 0 })}
              </dd>
            </div>
          </dl>
          <ul className="flex flex-col gap-0.5 text-muted-foreground text-xs">
            <li>{t("progress.requested", { time: time(run.created_at) })}</li>
            {run.started_at ? (
              <li>{t("progress.started", { time: time(run.started_at) })}</li>
            ) : null}
            {run.finished_at ? (
              <li>{t("progress.finished", { time: time(run.finished_at) })}</li>
            ) : null}
          </ul>
          {open ? (
            <p className="text-muted-foreground text-xs">{t("progress.resultsPending")}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
