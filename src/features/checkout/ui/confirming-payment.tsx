"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** How long to keep polling before telling the buyer we will email them instead (AC-5). */
const POLL_LIMIT_MS = 60_000;
const POLL_EVERY_MS = 3_000;

/**
 * The "confirming your payment" state (spec 0011, AC-5). The buyer has come back from Stripe but
 * the webhook has not landed yet, which is normal for a second or two.
 *
 * It only ever **reads**: it refreshes the server component until the row changes, and never
 * writes the order or assumes the payment failed. After a minute it stops polling and says the
 * confirmation will arrive by email, because the webhook and its retries are what settle the
 * order, not this page. Client component.
 */
export function ConfirmingPayment() {
  const t = useTranslations("orders");
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt >= POLL_LIMIT_MS) {
        setSlow(true);
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_EVERY_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <Alert aria-live="polite">
      <AlertTitle>{slow ? t("confirmingSlowTitle") : t("confirmingTitle")}</AlertTitle>
      <AlertDescription>{slow ? t("confirmingSlowBody") : t("confirmingBody")}</AlertDescription>
    </Alert>
  );
}
