"use client";

import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  type DeactivateExpertResult,
  deactivateExpert,
  type ReactivateExpertResult,
  type ResendInviteResult,
  reactivateExpert,
  resendInvite,
} from "@/features/experts/actions";
import type { ExpertStatus } from "@/features/experts/catalogue";
import { useFormAction } from "@/hooks/use-form-action";

export type ExpertAccountActionsProps = {
  readonly expertId: string;
  readonly status: ExpertStatus;
  /** The expert's display name, already resolved by the page, so the confirmation names them. */
  readonly fullName: string;
  /** Open assignments, so the confirmation says how many the deactivation will end. */
  readonly activeAssignments: number;
};

/**
 * The three account controls on an expert's admin page (spec 0013, AC-3, AC-10): resend the
 * invite, offboard the expert, bring them back. Which ones show is decided by the status, because
 * each is only meaningful in one state and the actions refuse the rest anyway.
 *
 * Deactivating and reactivating both stay enabled after a failure: each action is idempotent by
 * design, so pressing again is how a half finished offboarding is finished.
 *
 * Deactivating asks first, unlike the other two: it ends every open assignment and blocks the sign
 * in, and reactivating restores the sign in but not the assignments, so a misclick here is not
 * free to reverse. The dialog names the expert and the assignments it will end. Browser.
 */
export function ExpertAccountActions({
  expertId,
  status,
  fullName,
  activeAssignments,
}: ExpertAccountActionsProps) {
  const t = useTranslations("experts.account");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  const resend = useFormAction<ResendInviteResult, { expertId: string }>(resendInvite);
  const deactivate = useFormAction<DeactivateExpertResult, { expertId: string }>(deactivateExpert);
  const reactivate = useFormAction<ReactivateExpertResult, { expertId: string }>(reactivateExpert);

  useEffect(() => {
    if (resend.result?.ok) toast.success(t("resent"));
  }, [resend.result, t]);

  useEffect(() => {
    if (deactivate.result?.ok) {
      toast.success(t("deactivated", { count: deactivate.result.data.endedAssignments }));
      router.refresh();
    }
  }, [deactivate.result, router, t]);

  useEffect(() => {
    if (reactivate.result?.ok) {
      toast.success(t("reactivated"));
      router.refresh();
    }
  }, [reactivate.result, router, t]);

  const failure =
    (resend.result?.ok === false ? t(`resendErrors.${resend.result.error}`) : null) ??
    (deactivate.result?.ok === false ? t(`deactivateErrors.${deactivate.result.error}`) : null) ??
    (reactivate.result?.ok === false ? t(`reactivateErrors.${reactivate.result.error}`) : null);

  return (
    <div className="flex flex-col gap-4" data-expert-account-actions>
      {failure ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{failure}</AlertTitle>
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {status === "invited" ? (
          <Button
            type="button"
            variant="outline"
            disabled={resend.pending}
            onClick={() => resend.submit({ expertId })}
          >
            {resend.pending ? t("resending") : t("resend")}
          </Button>
        ) : null}
        {status === "inactive" ? (
          <Button
            type="button"
            disabled={reactivate.pending}
            onClick={() => reactivate.submit({ expertId })}
          >
            {reactivate.pending ? t("reactivating") : t("reactivate")}
          </Button>
        ) : (
          <Dialog open={confirming} onOpenChange={setConfirming}>
            <DialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={deactivate.pending}>
                {deactivate.pending ? t("deactivating") : t("deactivate")}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("deactivateConfirm", { name: fullName })}</DialogTitle>
                <DialogDescription>
                  {t("deactivateConfirmBody", { count: activeAssignments })}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    {t("deactivateCancel")}
                  </Button>
                </DialogClose>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={deactivate.pending}
                  onClick={() => {
                    deactivate.submit({ expertId });
                    setConfirming(false);
                  }}
                >
                  {t("deactivate")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {status === "inactive" ? t("inactiveHint") : t("activeHint")}
      </p>
    </div>
  );
}
