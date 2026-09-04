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
 * error, then shows `ErrorState` with the event id (or the Next.js digest) inside the sidebar
 * shell. Runs in the browser as a Next.js error boundary.
 */
export function AreaError({ error, retry }: AreaErrorProps) {
  const t = useTranslations("states.error");
  const [eventId, setEventId] = useState("");

  useEffect(() => {
    setEventId(Sentry.captureException(error));
  }, [error]);

  return (
    <PageStack>
      <ErrorState
        title={t("title")}
        description={t("description")}
        onRetry={retry}
        eventId={eventId || error.digest}
      />
    </PageStack>
  );
}
