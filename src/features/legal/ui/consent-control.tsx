"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { clearConsent, setConsent } from "@/features/legal/actions";
import type { ConsentChoice } from "@/features/legal/consent";
import { refreshConsent, useConsent, useMounted } from "@/features/legal/consent-store";

/**
 * The consent control on the cookies page (spec 0015, AC-8b, AC-4): it shows what the visitor
 * answered and lets them change it, whatever the current cookie says, so someone who rejected can
 * later accept without clearing their browser.
 *
 * It reads the answer client side after mount, exactly as the bar does, so the page it sits on
 * stays statically prerendered (AC-5). Before mount it shows the "not answered yet" line, which is
 * also the truthful server rendering: the server is never told the answer.
 *
 * "Change your choice" clears the cookie, which reopens the bar; accept and reject write directly,
 * so a visitor can also answer without waiting for the bar to come back. Browser.
 */
export function ConsentControl() {
  const t = useTranslations("legalPages.cookiesPage.choice");
  const mounted = useMounted();
  const consent = useConsent();
  const status = useTranslations("legal.consent.current");
  const [pending, startTransition] = useTransition();

  const answer = (choice: ConsentChoice) => {
    startTransition(async () => {
      if ((await setConsent(choice)).ok) refreshConsent();
    });
  };

  const reopen = () => {
    startTransition(async () => {
      if ((await clearConsent()).ok) refreshConsent();
    });
  };

  const current = !mounted || consent === null ? "none" : consent.choice;

  return (
    <div className="flex flex-col gap-4 border p-6">
      {/* The line changes without a navigation, so a screen reader is told rather than left behind. */}
      <p aria-live="polite" className="font-medium">
        {status(current)}
      </p>
      <p className="max-w-prose text-muted-foreground text-sm">{t("lead")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => answer("granted")}
          disabled={pending}
        >
          {t("accept")}
        </Button>
        <Button type="button" variant="outline" onClick={() => answer("denied")} disabled={pending}>
          {t("reject")}
        </Button>
        {current === "none" ? null : (
          <Button type="button" variant="ghost" onClick={reopen} disabled={pending}>
            {t("reopen")}
          </Button>
        )}
      </div>
    </div>
  );
}
