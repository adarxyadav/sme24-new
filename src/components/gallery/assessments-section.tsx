"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Example } from "@/components/gallery/gallery-section";
import type { RatingCode } from "@/features/assessments/catalogue";
import { RatingControl } from "@/features/assessments/ui/rating-control";
import { SaveIndicator } from "@/features/assessments/ui/save-indicator";

/**
 * The two primitives spec 0019 added (AC-13): the three way rating control in its unrated, chosen
 * and read only states, and the save indicator in every state it can show. Both appear here so
 * axe scans them on every run. A client section, because the control is interactive; the page
 * hands it the `gallery` and `assessments` namespaces through its own provider. Browser.
 */
export function AssessmentsSection() {
  const t = useTranslations("gallery");
  const ratings = useTranslations("assessments.ratings");
  const [unrated, setUnrated] = useState<RatingCode | null>(null);
  const [chosen, setChosen] = useState<RatingCode | null>("partial");
  const labels = {
    compliant: ratings("compliant"),
    partial: ratings("partial"),
    non_compliant: ratings("non_compliant"),
  } as const;

  return (
    <>
      <Example label={t("ratingControl")}>
        <div className="flex w-full flex-col gap-6">
          {(
            [
              ["ratingUnrated", unrated, setUnrated, false],
              ["ratingChosen", chosen, setChosen, false],
              ["ratingDisabled", "compliant", () => undefined, true],
            ] as const
          ).map(([key, value, onChange, disabled]) => (
            <div key={key} className="flex flex-col gap-2">
              <span id={`gallery-rating-${key}`} className="text-sm">
                {t("ratingControlLabel")}
                <span className="ml-2 text-muted-foreground text-xs">{t(key)}</span>
              </span>
              <RatingControl
                labelledBy={`gallery-rating-${key}`}
                value={value}
                onValueChange={onChange}
                labels={labels}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      </Example>

      <Example label={t("saveIndicator")}>
        <div className="flex w-full flex-col gap-3">
          {(
            [
              ["saveIdle", "idle"],
              ["savePending", "pending"],
              ["saveSaving", "saving"],
              ["saveSaved", "saved"],
              ["saveFailed", "failed"],
            ] as const
          ).map(([key, state]) => (
            <div key={key} className="flex items-center gap-6">
              <span className="w-48 text-muted-foreground text-xs">{t(key)}</span>
              <SaveIndicator
                state={state}
                savedAt="2026-09-12T14:02:00Z"
                onRetry={() => undefined}
              />
            </div>
          ))}
        </div>
      </Example>
    </>
  );
}
