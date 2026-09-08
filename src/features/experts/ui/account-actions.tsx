"use client";

import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
};

/**
 * The three account controls on an expert's admin page (spec 0013, AC-3, AC-10): resend the
 * invite, offboard the expert, bring them back. Which ones show is decided by the status, because
 * each is only meaningful in one state and the actions refuse the rest anyway.
 *
 * Deactivating and reactivating both stay enabled after a failure: each action is idempotent by
 * design, so pressing again is how a half finished offboarding is finished. Browser.
 */
export function ExpertAccountActions({ expertId, status }: ExpertAccountActionsProps) {
  const t = useTranslations("experts.account");
  const router = useRouter();

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
          <Button
            type="button"
            variant="destructive"
            disabled={deactivate.pending}
            onClick={() => deactivate.submit({ expertId })}
          >
            {deactivate.pending ? t("deactivating") : t("deactivate")}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-sm">
        {status === "inactive" ? t("inactiveHint") : t("activeHint")}
      </p>
    </div>
  );
}
