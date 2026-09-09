"use client";

import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setConsent } from "@/features/legal/actions";
import type { ConsentChoice } from "@/features/legal/consent";
import { refreshConsent, useConsent, useMounted } from "@/features/legal/consent-store";
import { Link } from "@/i18n/navigation";

/**
 * The cookie bar (spec 0015, AC-1, AC-2, AC-5, AC-5b). Rendered once in the root layout, so it
 * covers the signed in areas as well as the static marketing pages: PostHog can load anywhere, so
 * consent governs everywhere.
 *
 * It renders nothing at all on the server and through hydration, and appears only when the mount
 * check finds no current answer. A visible default would flash on every load for a visitor who
 * already chose, and jsdom would not catch it — the same shape of bug as the ICU grouping
 * hydration failure. Because the choice is read client side, the page it sits on stays static.
 *
 * Accept and reject are the same component, the same variant, the same size, side by side, and
 * neither is preselected (AC-2).
 *
 * While it is showing it publishes its own height as `--consent-bar-height` on the document, and
 * removes the variable when it goes. The bar is fixed to the bottom of the viewport, and the
 * signed in sidebar is `h-svh`, so without this the bar sits on top of the sidebar footer and the
 * user menu underneath it cannot be clicked at all. Anything anchored to the bottom of a signed in
 * page can reserve the same space. Browser.
 */
export function CookieBar() {
  const t = useTranslations("legal.consent");
  const mounted = useMounted();
  const consent = useConsent();
  const [pending, startTransition] = useTransition();
  const [dismissed, setDismissed] = useState(false);
  const bar = useRef<HTMLElement>(null);

  const showing = mounted && consent === null && !dismissed;

  // Layout effect rather than an effect: the variable must be set in the same paint the bar
  // appears in, or the sidebar footer jumps once on every first load.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!showing) {
      root.style.removeProperty("--consent-bar-height");
      return;
    }
    const element = bar.current;
    if (!element) return;
    const publish = () => {
      root.style.setProperty("--consent-bar-height", `${element.offsetHeight}px`);
    };
    publish();
    // The bar wraps to two rows on a narrow viewport, so its height is not a constant.
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--consent-bar-height");
    };
  }, [showing]);

  const answer = (choice: ConsentChoice) => {
    startTransition(async () => {
      const result = await setConsent(choice);
      if (result.ok) {
        refreshConsent();
        setDismissed(true);
      }
    });
  };

  if (!showing) return null;

  return (
    <section
      ref={bar}
      // A dialog would trap focus and block the page before anyone has read a word of it; the
      // choice is not modal, so it is a labelled region the keyboard reaches in order.
      aria-label={t("title")}
      data-testid="cookie-bar"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-background"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-8">
        <p className="max-w-prose text-pretty text-sm">
          {t.rich("body", {
            link: (chunks) => (
              <Link href="/cookies" className="whitespace-nowrap underline underline-offset-4">
                {chunks}
              </Link>
            ),
          })}
        </p>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => answer("denied")}
            disabled={pending}
            className="flex-1 md:flex-none"
          >
            {t("reject")}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => answer("granted")}
            disabled={pending}
            className="flex-1 md:flex-none"
          >
            {t("accept")}
          </Button>
        </div>
      </div>
    </section>
  );
}
