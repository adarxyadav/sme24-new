"use client";

import { BellRingIcon, SendIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { sendTestAlert, sendTestEmail } from "@/features/emails/actions";
import { toastEmailResult } from "./retry-button";

/**
 * The two configuration checks of `/admin/emails` (spec 0006, AC-10): a welcome email to the
 * signed in ops user and an `ops.test` Slack alert, each answered with the run id in a toast.
 * Client component.
 */
export function TestButtons() {
  const t = useTranslations("emails");
  const [emailPending, startEmail] = useTransition();
  const [alertPending, startAlert] = useTransition();

  return (
    <section aria-labelledby="test-heading" className="flex flex-col gap-4 rounded-lg border p-6">
      <div>
        <h2 id="test-heading" className="font-semibold text-lg">
          {t("actions.testHeading")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("actions.testIntro")}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={emailPending}
          aria-busy={emailPending}
          onClick={() =>
            startEmail(async () => toastEmailResult(await sendTestEmail(), t, "testEmailQueued"))
          }
        >
          <SendIcon data-icon="inline-start" aria-hidden="true" />
          {t("actions.testEmail")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={alertPending}
          aria-busy={alertPending}
          onClick={() =>
            startAlert(async () => toastEmailResult(await sendTestAlert(), t, "testAlertQueued"))
          }
        >
          <BellRingIcon data-icon="inline-start" aria-hidden="true" />
          {t("actions.testAlert")}
        </Button>
      </div>
    </section>
  );
}
