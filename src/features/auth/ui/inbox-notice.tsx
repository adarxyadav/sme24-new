"use client";

import { MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { AuthResult } from "@/features/auth/actions";
import { useAuthAction } from "./use-auth-action";

export type InboxKind = "signUp" | "code" | "reset";

type ResendInput = { email: string; locale: string };

export type InboxNoticeProps = {
  readonly kind: InboxKind;
  readonly email: string;
  readonly locale: string;
  /** The action that sends the same email again; omitted when nothing can be resent. */
  readonly resend?: (
    previous: AuthResult<{ email: string }> | null,
    input: unknown,
  ) => Promise<AuthResult<{ email: string }>>;
  readonly children?: React.ReactNode;
};

/**
 * The "check your inbox" state every email sending action lands on (AC-1, AC-4, AC-6, AC-12),
 * with a resend button that reports success without revealing whether the address exists. Browser.
 */
export function InboxNotice({ kind, email, locale, resend, children }: InboxNoticeProps) {
  const t = useTranslations("auth.inbox");
  const action = useAuthAction<{ email: string }, ResendInput>(
    resend ?? (async () => ({ ok: true, data: { email } })),
  );

  return (
    <div className="flex flex-col gap-4">
      <Alert variant="info">
        <MailIcon aria-hidden="true" />
        <AlertTitle>{t("title")}</AlertTitle>
        <AlertDescription>{t(kind, { email })}</AlertDescription>
      </Alert>
      {action.result?.ok ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("resent")}
        </p>
      ) : null}
      {resend ? (
        <Button
          type="button"
          variant="outline"
          disabled={action.pending}
          onClick={() => action.submit({ email, locale })}
        >
          {t("resend")}
        </Button>
      ) : null}
      {children}
    </div>
  );
}
