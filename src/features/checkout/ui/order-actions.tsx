"use client";

import { CheckIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  cancelOrder,
  markOrderPaid,
  type OpsActionResult,
  retryInvoiceRender,
} from "../ops-actions";

export type OrderActionsProps = {
  readonly orderId: string;
  readonly reference: string;
  readonly status: string;
  readonly invoiceId: string | null;
  /** True when the render exhausted its retries, so the retry button is offered. */
  readonly renderFailed: boolean;
};

/**
 * The ops controls on one order row (spec 0011, AC-9, AC-10): confirm a bank transfer arrived,
 * cancel a stale pending order with a reason, and retry an invoice render that gave up.
 *
 * Marking paid runs the same `settleOrder` core a card payment does, so the two paths cannot
 * drift; cancelling asks for a reason because it lands on the `order_events` row.
 * Client component.
 */
export function OrderActions({
  orderId,
  reference,
  status,
  invoiceId,
  renderFailed,
}: OrderActionsProps) {
  const t = useTranslations("adminOrders");
  const [paidState, paidAction, paidPending] = useActionState<OpsActionResult | null, unknown>(
    markOrderPaid,
    null,
  );
  const [cancelState, cancelAction, cancelPending] = useActionState<
    OpsActionResult | null,
    unknown
  >(cancelOrder, null);
  const [retryState, retryAction, retryPending] = useActionState<OpsActionResult | null, unknown>(
    retryInvoiceRender,
    null,
  );
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  const settled = paidState?.ok || cancelState?.ok;
  if (settled) return <span className="text-xs text-muted-foreground">{t("done")}</span>;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "pending" ? (
        <>
          <Button
            type="button"
            size="sm"
            disabled={paidPending}
            onClick={() => startTransition(() => paidAction({ orderId }))}
          >
            <CheckIcon data-icon="inline-start" aria-hidden="true" />
            {t("markPaid")}
          </Button>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" variant="outline">
                <XIcon data-icon="inline-start" aria-hidden="true" />
                {t("cancel")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("cancelConfirm")}</DialogTitle>
                <DialogDescription>{t("markPaidConfirm", { reference })}</DialogDescription>
              </DialogHeader>
              <Field>
                <FieldLabel htmlFor={`reason-${orderId}`}>{t("cancelReason")}</FieldLabel>
                <Textarea
                  id={`reason-${orderId}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                />
              </Field>
              <DialogFooter>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={cancelPending || reason.trim() === ""}
                  onClick={() =>
                    startTransition(() => {
                      cancelAction({ orderId, reason });
                      setOpen(false);
                    })
                  }
                >
                  {t("cancelConfirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      {renderFailed && invoiceId ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={retryPending || retryState?.ok}
          onClick={() => startTransition(() => retryAction({ invoiceId }))}
        >
          <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          {t("retryRender")}
        </Button>
      ) : null}
    </div>
  );
}
