"use client";

import { PlayIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { type StartAssessmentResult, startAssessment } from "@/features/assessments/actions";
import type { QuestionnaireKey } from "@/features/assessments/catalogue";
import { useFormAction } from "@/hooks/use-form-action";
import { useRouter } from "@/i18n/navigation";

export type StartAssessmentButtonProps = {
  readonly organizationId: string;
  readonly companyId: string;
  readonly questionnaireKey: QuestionnaireKey;
};

/**
 * Starts a draft of one questionnaire for the chosen company (spec 0019, AC-5) and opens it. The
 * toast and the navigation hang off the click that caused them: `submit` resolves with that one
 * dispatch's result, so nothing here watches `result` in an effect. Browser.
 */
export function StartAssessmentButton({
  organizationId,
  companyId,
  questionnaireKey,
}: StartAssessmentButtonProps) {
  const t = useTranslations("assessments.start");
  const router = useRouter();
  const start = useFormAction<
    StartAssessmentResult,
    { organizationId: string; companyId: string; questionnaireKey: QuestionnaireKey }
  >(startAssessment);

  async function begin() {
    const outcome = await start.submit({ organizationId, companyId, questionnaireKey });
    if (!outcome.ok) {
      toast.error(t(`errors.${outcome.error}`));
      return;
    }
    toast.success(t("started"));
    router.push({
      pathname: "/expert/clients/[organizationId]/assessments/[assessmentId]",
      params: { organizationId, assessmentId: outcome.data.assessmentId },
    });
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={start.pending}
      onClick={begin}
      data-start={questionnaireKey}
    >
      <PlayIcon data-icon="inline-start" aria-hidden="true" />
      {start.pending ? t("starting") : t("button")}
    </Button>
  );
}
