import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { type ConfidenceLevel, confidenceLevel } from "@/features/research/catalogue";

const STATUS_VARIANT = {
  queued: "outline",
  running: "info",
  succeeded: "success",
  empty: "warning",
  failed: "destructive",
} as const;

export type RunStatus = keyof typeof STATUS_VARIANT;

/** True when `value` is one of the five run statuses. Pure. */
export function isRunStatus(value: string): value is RunStatus {
  return value in STATUS_VARIANT;
}

/** The status badge of a run (AC-7). Server or client (reads `research.status`). */
export function RunStatusBadge({ status }: { readonly status: string }) {
  const t = useTranslations("research.status");
  const known = isRunStatus(status) ? status : "queued";
  return (
    <Badge variant={STATUS_VARIANT[known]} data-status={known}>
      {t(known)}
    </Badge>
  );
}

const CONFIDENCE_VARIANT: Record<ConfidenceLevel, "success" | "warning" | "secondary"> = {
  high: "success",
  medium: "warning",
  low: "secondary",
};

/**
 * The confidence badge of a KPI value (AC-7): high, medium or low with the level as text. A caller
 * that stands the badge alone, away from a "Confidence" column heading, passes `label` with the
 * word spelled out ("Medium confidence"), so the colour is never the only carrier; the visible
 * text is then the whole name and no `aria-label` restates it. Server or client.
 */
export function ConfidenceBadge({
  confidence,
  label,
}: {
  readonly confidence: number;
  readonly label?: string;
}) {
  const t = useTranslations("research.table.confidence");
  const level = confidenceLevel(confidence);
  return (
    <Badge
      variant={CONFIDENCE_VARIANT[level]}
      data-confidence={level}
      aria-label={label ? undefined : `${t("label")}: ${t(level)}`}
      title={`${t("label")}: ${Math.round(confidence * 100)} %`}
    >
      {label ?? t(level)}
    </Badge>
  );
}
