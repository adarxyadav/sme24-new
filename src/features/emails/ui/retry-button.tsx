"use client";

import { RotateCcwIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type EmailActionResult, retryDelivery } from "@/features/emails/actions";

/** Shows the outcome of an email action as a toast (spec 0006, AC-10). Browser. */
export function toastEmailResult(
  result: EmailActionResult,
  t: ReturnType<typeof useTranslations<"emails">>,
  successKey: "retryQueued" | "testEmailQueued" | "testAlertQueued",
): void {
  if (result.ok) {
    toast.success(t(`toasts.${successKey}`, { runId: result.data.runId }));
    return;
  }
  const key = {
    forbidden: "forbidden",
    invalid: "invalid",
    not_retryable: "notRetryable",
    webhook_unset: "webhookUnset",
    trigger_unavailable: "triggerUnavailable",
    trigger_failed: "triggerFailed",
  } as const;
  toast.error(t(`toasts.${key[result.error]}`));
}

/**
 * Retries a failed delivery (AC-10): triggers the task, toasts the run id and refreshes the page
 * so the row shows `sending` (Realtime carries the later states). Client component.
 */
export function RetryButton({ deliveryId }: { readonly deliveryId: string }) {
  const t = useTranslations("emails");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function retry() {
    startTransition(async () => {
      const result = await retryDelivery({ deliveryId });
      toastEmailResult(result, t, "retryQueued");
      if (result.ok) router.refresh();
    });
  }

  return (
    <Button type="button" onClick={retry} disabled={pending} aria-busy={pending}>
      <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
      {pending ? t("actions.retrying") : t("actions.retry")}
    </Button>
  );
}
