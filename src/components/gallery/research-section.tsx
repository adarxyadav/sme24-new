"use client";

import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { Badge } from "@/components/ui/badge";
import { type ProgressItem, ProgressList } from "@/components/ui/progress-list";

const LABELS = ["queued", "searching", "extracting", "saving", "done"] as const;

function items(
  states: readonly ProgressItem["state"][],
  labels: (key: string) => string,
): readonly ProgressItem[] {
  return LABELS.map((key, index) => ({
    id: key,
    label: labels(key),
    state: states[index] ?? "pending",
  }));
}

/** The progress list in its three shapes and the confidence badges (spec 0007, AC-16). Runs in the browser. */
export function ResearchSection() {
  const t = useTranslations("gallery.research");
  const steps = useTranslations("research.steps");
  const confidence = useTranslations("research.table.confidence");
  const table = useTranslations("research.table");
  const label = (key: string) => steps(key as "queued");
  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-8 lg:grid-cols-3">
        <Example label={t("progressIdle")}>
          <ProgressList
            items={items(["pending", "pending", "pending", "pending", "pending"], label)}
          />
        </Example>
        <Example label={t("progressRunning")}>
          <ProgressList items={items(["done", "done", "current", "pending", "pending"], label)} />
        </Example>
        <Example label={t("progressFailed")}>
          <ProgressList items={items(["done", "failed", "pending", "pending", "pending"], label)} />
        </Example>
      </div>
      <Example label={t("confidence")}>
        <Badge variant="success" data-confidence="high">
          {confidence("high")}
        </Badge>
        <Badge variant="warning" data-confidence="medium">
          {confidence("medium")}
        </Badge>
        <Badge variant="secondary" data-confidence="low">
          {confidence("low")}
        </Badge>
        <Badge variant="outline">
          <InfoIcon aria-hidden="true" />
          {table("notVerified")}
        </Badge>
      </Example>
    </div>
  );
}
