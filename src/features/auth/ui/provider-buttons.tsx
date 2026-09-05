"use client";

import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { signInWithProvider } from "@/features/auth/actions";
import type { Provider, SignInWithProviderInput } from "@/features/auth/schema";
import { AuthErrorAlert } from "./auth-error-alert";
import { useAuthAction } from "./use-auth-action";

/**
 * Google and Microsoft (AC-5): each button starts the provider flow through the action so the
 * PKCE verifier cookie is set on the action response. Browser.
 */
export function ProviderButtons({ next }: { readonly next?: string }) {
  const t = useTranslations("auth.providers");
  const locale = useLocale();
  const action = useAuthAction<undefined, SignInWithProviderInput>(signInWithProvider);
  const start = (provider: Provider) => action.submit({ provider, locale, next });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-muted-foreground text-xs">{t("or")}</span>
        <Separator className="flex-1" />
      </div>
      <AuthErrorAlert error={action.result?.ok === false ? action.result.error : null} />
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={action.pending}
          onClick={() => start("google")}
        >
          {t("google")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={action.pending}
          onClick={() => start("azure")}
        >
          {t("microsoft")}
        </Button>
      </div>
    </div>
  );
}
