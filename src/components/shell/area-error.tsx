"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { PageStack } from "@/components/page-stack";

export type AreaErrorProps = {
  readonly error: Error & { digest?: string };
  readonly retry: () => void;
};

/**
 * The `error.tsx` body shared by the three areas (spec 0003, AC-7): reports to Sentry once per
 * error, then shows `ErrorState` with a reference inside the sidebar shell. The reference is the
 * Next.js digest (what the server log carries) plus the Sentry event id when a client is enabled.
 * Runs in the browser as a Next.js error boundary.
 */
export function AreaError({ error, retry }: AreaErrorProps) {
  const t = useTranslations("states.error");
  const [eventId, setEventId] = useState("");

  useEffect(() => {
    // `captureException` returns an id even without an enabled client (no DSN on previews), so
    // only an id Sentry actually received is shown.
    const id = Sentry.captureException(error);
    setEventId(Sentry.isEnabled() ? id : "");
  }, [error]);

  const reference = [error.digest, eventId].filter(Boolean).join(" / ");

  return (
    <PageStack>
      <ErrorState
        title={t("title")}
        description={t("description")}
        onRetry={retry}
        eventId={reference || undefined}
      />
    </PageStack>
  );
}
