import { ArrowLeftIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { Progress as ProgressModel, Score } from "@/features/assessments/model";
import type { AssessmentPage } from "@/features/assessments/queries";
import { Link } from "@/i18n/navigation";
import type { LocaleCode } from "@/i18n/routing";
import { DetailsForm } from "./details-form";
import { SubmitDialog } from "./submit-dialog";

export type AssessmentHeaderProps = {
  readonly page: AssessmentPage;
  readonly score: Score;
  readonly progress: ProgressModel;
  readonly locale: LocaleCode;
};

/**
 * The head of the assessment page (spec 0019, AC-6): the questionnaire title, the company, the
 * status, the progress over the required items, the running score and, while the draft is open,
 * the site and date form plus the submit control. Once submitted the same strip shows the locked
 * facts. Server.
 */
export async function AssessmentHeader({ page, score, progress, locale }: AssessmentHeaderProps) {
  const [t, format] = await Promise.all([getTranslations("assessments"), getFormatter()]);
  const { assessment, status } = page;
  const draft = status === "draft";
  const company = page.companyName ?? page.organizationName ?? "—";

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={{
          pathname: "/expert/clients/[organizationId]",
          params: { organizationId: assessment.organization_id },
        }}
        className="inline-flex w-fit items-center gap-1.5 text-muted-foreground text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4" />
        {t("page.backToClient", { company })}
      </Link>

      <PageHeader
        title={page.version.title[locale]}
        description={t("page.lead", { company })}
        actions={
          draft ? (
            <SubmitDialog
              assessmentId={assessment.id}
              unrated={progress.unrated}
              sections={progress.sections
                .filter((section) => section.unrated > 0)
                .map(({ key, label, title, unrated }) => ({ key, label, title, unrated }))}
              locale={locale}
            />
          ) : undefined
        }
      />

      <div className="flex flex-col gap-5 rounded-xl border bg-card p-5 text-card-foreground shadow-xs">
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <dt className="text-muted-foreground text-sm">{t("page.status")}</dt>
            <dd>
              <Badge variant={draft ? "info" : "success"} data-assessment-status={status}>
                {t(`status.${status}`)}
              </Badge>
              {assessment.submitted_at ? (
                <span className="ml-2 text-muted-foreground text-sm">
                  {format.dateTime(new Date(assessment.submitted_at), "dateTime")}
                </span>
              ) : null}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-muted-foreground text-sm">{t("page.progress")}</dt>
            <dd className="flex flex-col gap-2">
              <span className="font-medium text-sm tabular-nums" data-assessment-progress>
                {t("page.rated", { rated: progress.rated, required: progress.required })}
              </span>
              <Progress
                value={progress.required === 0 ? 0 : (100 * progress.rated) / progress.required}
                aria-label={t("page.progress")}
              />
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-muted-foreground text-sm">
              {draft ? t("page.runningScore") : t("page.score")}
            </dt>
            <dd
              className="font-medium text-heading-24 tabular-nums"
              data-numeric
              data-assessment-score
            >
              {score.overall === null
                ? t("page.noScore")
                : format.number(score.overall / 100, "percent")}
            </dd>
          </div>
        </dl>

        {draft ? (
          <DetailsForm
            assessmentId={assessment.id}
            site={assessment.site}
            conductedOn={assessment.conducted_on}
          />
        ) : (
          <dl className="grid gap-x-8 gap-y-4 border-t pt-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t("details.site")}</dt>
              <dd className="text-sm">{assessment.site ?? t("details.none")}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t("details.conductedOn")}</dt>
              <dd className="text-sm">
                {assessment.conducted_on
                  ? format.dateTime(new Date(`${assessment.conducted_on}T12:00:00Z`), "dateShort")
                  : t("details.none")}
              </dd>
            </div>
          </dl>
        )}
      </div>
    </div>
  );
}
