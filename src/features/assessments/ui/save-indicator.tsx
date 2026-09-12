"use client";

import { AlertCircleIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Where one item's save stands: nothing to say, a change waiting, in flight, landed, or failed. */
export type SaveState = "idle" | "pending" | "saving" | "saved" | "failed";

export type SaveIndicatorProps = {
  readonly state: SaveState;
  /** The `updated_at` the last successful save answered with; shown as a time next to "Saved". */
  readonly savedAt: string | null;
  /** The manual retry after the automatic ones gave up; shown only in the failed state. */
  readonly onRetry?: () => void;
  readonly className?: string;
};

/**
 * The per item save status (spec 0019, AC-6, AC-13): a polite live region that says saving,
 * saved at a time, or failed with a retry. Always rendered, even when idle, so the region exists
 * before its first announcement and a screen reader hears the change rather than a new element.
 * Reads the `assessments.save` keys, so the page hands it the namespace. Browser.
 */
export function SaveIndicator({ state, savedAt, onRetry, className }: SaveIndicatorProps) {
  const t = useTranslations("assessments.save");
  const format = useFormatter();

  return (
    <div
      data-slot="save-indicator"
      data-state={state}
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-6 items-center gap-1.5 text-muted-foreground text-xs",
        state === "failed" && "text-destructive",
        className,
      )}
    >
      {state === "pending" ? <span>{t("pending")}</span> : null}
      {state === "saving" ? (
        <>
          <LoaderCircleIcon aria-hidden="true" className="size-3.5 animate-spin" />
          <span>{t("saving")}</span>
        </>
      ) : null}
      {state === "saved" ? (
        <>
          <CheckIcon aria-hidden="true" className="size-3.5" />
          <span>
            {savedAt
              ? t("savedAt", {
                  time: format.dateTime(new Date(savedAt), { hour: "2-digit", minute: "2-digit" }),
                })
              : t("saved")}
          </span>
        </>
      ) : null}
      {state === "failed" ? (
        <>
          <AlertCircleIcon aria-hidden="true" className="size-3.5" />
          <span>{t("failed")}</span>
          {onRetry ? (
            <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={onRetry}>
              {t("retry")}
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
