"use client";

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ErrorStateProps = {
  readonly title: string;
  readonly description: string;
  /** Re renders the failed segment; wired to the boundary's `retry`. */
  readonly onRetry?: () => void;
  /** Sentry event id or the Next.js digest, shown so a user can quote it to support. */
  readonly eventId?: string;
  readonly className?: string;
};

/**
 * What a failed page or section shows (spec 0003): message, retry, reference id. Runs in the
 * browser, inside an `error.tsx` boundary or a section that caught its own error.
 */
export function ErrorState({ title, description, onRetry, eventId, className }: ErrorStateProps) {
  const t = useTranslations("states.error");
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn(
        "flex flex-col items-center gap-4 rounded-lg border border-destructive/30 bg-destructive-subtle px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-md bg-destructive text-destructive-foreground"
      >
        <AlertTriangleIcon className="size-5" />
      </span>
      <div className="flex max-w-prose flex-col gap-1">
        <p className="font-medium text-base">{title}</p>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
          {t("retry")}
        </Button>
      ) : null}
      {eventId ? (
        <p className="font-mono text-muted-foreground text-xs">{t("reference", { id: eventId })}</p>
      ) : null}
    </div>
  );
}
