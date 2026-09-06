"use client";

import { OctagonXIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type { ResearchActionResult } from "@/features/research/actions";
import { RUN_LIMIT_PER_DAY } from "@/features/research/catalogue";

/** The inline message of a failed research action (AC-9), announced as an alert. Browser. */
export function ResearchErrorAlert({
  result,
}: {
  readonly result: ResearchActionResult<unknown> | null;
}) {
  const t = useTranslations("research.errors");
  if (!result || result.ok) return null;
  return (
    <Alert variant="destructive" role="alert" data-error={result.error}>
      <OctagonXIcon aria-hidden="true" />
      <AlertTitle>{t(result.error, { limit: RUN_LIMIT_PER_DAY })}</AlertTitle>
      <AlertDescription className="sr-only">{t("validation")}</AlertDescription>
    </Alert>
  );
}
