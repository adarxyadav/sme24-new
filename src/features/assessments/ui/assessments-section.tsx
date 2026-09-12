import { ClipboardListIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QUESTIONNAIRE_KEYS } from "@/features/assessments/catalogue";
import type { AssessmentListRow } from "@/features/assessments/queries";
import { Link } from "@/i18n/navigation";
import type { LocaleCode } from "@/i18n/routing";
import { StartAssessmentButton } from "./start-assessment-button";

export type AssessmentsSectionProps = {
  readonly organizationId: string;
  /** The organization's company an assessment is started for; null while the client has none yet. */
  readonly companyId: string | null;
  readonly rows: readonly AssessmentListRow[];
  readonly locale: LocaleCode;
};

/**
 * The Assessments section of the expert's client page (spec 0019, AC-5): per questionnaire a
 * Start button when no draft of it exists for the company, else a Continue link, and the list of
 * the organization's assessments with title, status, dates, the locked score and a link to each.
 * Reads the `assessments` namespace; the page hands the same namespace to the start button. Server.
 */
export async function AssessmentsSection({
  organizationId,
  companyId,
  rows,
  locale,
}: AssessmentsSectionProps) {
  const [t, format] = await Promise.all([getTranslations("assessments"), getFormatter()]);

  return (
    <section aria-labelledby="client-assessments-heading" className="flex flex-col gap-4">
      <h2 id="client-assessments-heading" className="font-semibold text-lg">
        {t("section.heading")}
      </h2>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t("section.lead")}</p>
          {companyId ? (
            <ul className="flex flex-col gap-3 sm:flex-row sm:flex-wrap" data-assessment-starts>
              {QUESTIONNAIRE_KEYS.map((key) => {
                const draft = rows.find(
                  (row) =>
                    row.questionnaireKey === key &&
                    row.companyId === companyId &&
                    row.status === "draft",
                );
                return (
                  <li
                    key={key}
                    className="flex flex-1 flex-col gap-3 rounded-lg border p-4 sm:min-w-64"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium text-sm">{t(`questionnaires.${key}`)}</span>
                      <span className="text-muted-foreground text-xs">
                        {draft
                          ? t("section.draftSince", {
                              date: format.dateTime(new Date(draft.createdAt), "dateShort"),
                            })
                          : t("section.notStarted")}
                      </span>
                    </div>
                    {draft ? (
                      <Button asChild size="sm" variant="outline" className="w-fit">
                        <Link
                          href={{
                            pathname: "/expert/clients/[organizationId]/assessments/[assessmentId]",
                            params: { organizationId, assessmentId: draft.id },
                          }}
                          data-continue={key}
                        >
                          {t("section.continue")}
                        </Link>
                      </Button>
                    ) : (
                      <StartAssessmentButton
                        organizationId={organizationId}
                        companyId={companyId}
                        questionnaireKey={key}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("section.noCompany")}</p>
          )}
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <p className="flex items-center gap-2 text-muted-foreground text-sm">
          <ClipboardListIcon aria-hidden="true" className="size-4" />
          {t("section.empty")}
        </p>
      ) : (
        <Card>
          <CardContent className="px-0">
            <Table density="compact" data-assessment-list>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("section.columns.questionnaire")}</TableHead>
                  <TableHead>{t("section.columns.status")}</TableHead>
                  <TableHead>{t("section.columns.started")}</TableHead>
                  <TableHead>{t("section.columns.submitted")}</TableHead>
                  <TableHead className="text-right">{t("section.columns.score")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{t("section.columns.open")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.questionnaireTitle[locale]}</TableCell>
                    <TableCell>
                      <Badge variant={row.status === "submitted" ? "success" : "info"}>
                        {t(`status.${row.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format.dateTime(new Date(row.createdAt), "dateShort")}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {row.submittedAt
                        ? format.dateTime(new Date(row.submittedAt), "dateShort")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums" data-numeric>
                      {row.score === null ? "—" : format.number(row.score / 100, "percent")}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="xs" variant="ghost">
                        <Link
                          href={{
                            pathname: "/expert/clients/[organizationId]/assessments/[assessmentId]",
                            params: { organizationId, assessmentId: row.id },
                          }}
                        >
                          {t("section.open")}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
