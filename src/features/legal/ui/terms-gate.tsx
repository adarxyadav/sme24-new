"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { signOut } from "@/features/auth/actions";
import { acceptTerms } from "@/features/legal/actions";
import { CURRENT_TERMS_VERSION } from "@/features/legal/terms";
import { Link } from "@/i18n/navigation";

/**
 * The re consent dialog (spec 0015, AC-10). Rendered by the shared area shell only when the
 * caller's stored `terms_version` is not the current one, so a current profile renders nothing at
 * all and pays no dialog.
 *
 * It cannot be dismissed. What actually guarantees that is the controlled `open` prop with no
 * `onOpenChange`: Radix asks to close, nothing listens, and the dialog stays. The three
 * `preventDefault` handlers below are the second layer, and they matter the moment anyone adds an
 * `onOpenChange` here — remove them and escape closes the gate again. There is no state in which
 * `open` becomes false while the terms are still stale. That is the point: a dialog the user can
 * wave away is not a gate. The honest way out is the second control, sign out, for someone who
 * does not accept the new terms; accepting is the only path back in.
 *
 * The dialog is a render concern, exactly like the expert gate: it never runs for a server action
 * post, so nothing here is a security boundary. The boundary is the column grant, which leaves
 * `terms_version` unwritable by anything but `accept_terms()`.
 *
 * Browser; the shell hands it the `legal` namespace, which is already shared for the cookie bar.
 */
export function TermsGate({ locale }: { readonly locale: string }) {
  const t = useTranslations("legal.terms");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  // Set on success so the dialog closes on the spot. The shell's next render agrees, because the
  // row it reads has moved; this is only what spares the user a wait for the refresh.
  const [accepted, setAccepted] = useState(false);

  const accept = () => {
    setFailed(false);
    startTransition(async () => {
      const result = await acceptTerms();
      if (result.ok) setAccepted(true);
      else setFailed(true);
    });
  };

  return (
    <Dialog open={!accepted}>
      <DialogContent
        showCloseButton={false}
        // The second layer. With `open` controlled and no `onOpenChange`, these are redundant
        // today; they are what keeps the gate shut if one is ever added.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        data-testid="terms-gate"
      >
        <DialogHeader>
          <DialogTitle>{t("gate.title")}</DialogTitle>
          <DialogDescription>{t("gate.body")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm">{t(`changelog.${CURRENT_TERMS_VERSION}`)}</p>
          <p className="text-sm">
            <Link
              href="/terms"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {t("gate.read")}
            </Link>
          </p>
          {failed && (
            <p role="alert" className="text-destructive text-sm">
              {t("gate.error")}
            </p>
          )}
        </div>

        <DialogFooter>
          {/* Sign out is a plain form post, the same shape the sidebar uses, so it works whether or
              not the accept transition is in flight. */}
          <form action={signOut}>
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              {t("gate.decline")}
            </Button>
          </form>
          <Button type="button" onClick={accept} disabled={pending}>
            {t("gate.accept")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
