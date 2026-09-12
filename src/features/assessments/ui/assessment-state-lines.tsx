import { useFormatter, useTranslations } from "next-intl";
import { QUESTIONNAIRE_KEYS, type QuestionnaireKey } from "@/features/assessments/catalogue";
import { type AssessmentState, orderAssessmentLines } from "@/features/assessments/states";
import { cn } from "@/lib/utils";

export type AssessmentStateLinesProps = {
  readonly packageKey: string;
  /** The assessments linked to this order, from `listAssessmentStates`. */
  readonly states: readonly AssessmentState[];
  readonly className?: string;
};

/**
 * The state of a booked order's assessments (spec 0019, AC-10), one line per questionnaire: not
 * started, in progress since a date, or submitted on a date, and nothing else. Shared by the
 * client's card on `/app` and the ops orders table, so the two can never disagree. Synchronous
 * on purpose (the hooks resolve from the request config in a server component), so the card can
 * be rendered whole by a test. Server component.
 */
export function AssessmentStateLines({ packageKey, states, className }: AssessmentStateLinesProps) {
  const t = useTranslations("assessments");
  const format = useFormatter();
  const lines = orderAssessmentLines(packageKey, states);
  const date = (iso: string) => format.dateTime(new Date(iso), "dateShort");

  return (
    <ul
      aria-label={t("state.label")}
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      data-assessment-states
    >
      {lines.map((line) => {
        const state =
          line.state === "in_progress" && line.at
            ? t("state.inProgressSince", { date: date(line.at) })
            : line.state === "submitted" && line.at
              ? t("state.submittedOn", { date: date(line.at) })
              : t("state.notStarted");
        const title =
          line.questionnaireKey === null
            ? null
            : QUESTIONNAIRE_KEYS.includes(line.questionnaireKey as QuestionnaireKey)
              ? t(`questionnaires.${line.questionnaireKey as QuestionnaireKey}`)
              : line.questionnaireKey;
        return (
          <li
            key={line.questionnaireKey ?? "none"}
            data-assessment-state={line.state}
            className="text-muted-foreground"
          >
            {title === null ? state : t("state.line", { title, state })}
          </li>
        );
      })}
    </ul>
  );
}
