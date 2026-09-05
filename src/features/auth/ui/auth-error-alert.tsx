"use client";

import { AlertCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertTitle } from "@/components/ui/alert";
import type { AuthActionError } from "@/features/auth/actions";

/** The one destructive alert of the auth forms (AC-12): the message for an action's error key. Browser. */
export function AuthErrorAlert({ error }: { readonly error: AuthActionError | null | undefined }) {
  const t = useTranslations("auth.errors");
  if (!error) return null;
  return (
    <Alert variant="destructive">
      <AlertCircleIcon aria-hidden="true" />
      <AlertTitle>{t(error === "invalidInput" ? "generic" : error)}</AlertTitle>
    </Alert>
  );
}
