import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GapEntry, Score } from "@/features/assessments/model";
import type { LocaleCode } from "@/i18n/routing";

export type ScoreSummaryProps = {
  readonly score: Score;
  readonly gaps: readonly GapEntry[];
  readonly locale: LocaleCode;
};

/**
 * The locked score on top of a submitted assessment (spec 0019, AC-9): the overall percentage, a
 * per section table (percentage, rated over total, or excluded with its note) and the gap list,
 * non compliant first then partial, each with label, title, section and note, then every section
 * marked not applicable with its reason (AC-8). Every number comes from `computeScore` and
 * `gapList`, the same functions the running score used. Server.
 */
export async function ScoreSummary({ score, gaps, locale }: ScoreSummaryProps) {
  const [t, format] = await Promise.all([getTranslations("assessments.summary"), getFormatter()]);
  const excluded = score.sections.filter((section) => section.excluded);
  const percent = (value: number | null) =>
    value === null ? "—" : format.number(value / 100, "percent");

  return (
    <section
      aria-labelledby="score-summary-heading"
      className="flex flex-col gap-6 rounded-xl border bg-card p-5 text-card-foreground shadow-xs"
      data-score-summary
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id="score-summary-heading" className="font-semibold text-lg">
            {t("heading")}
          </h2>
          <p className="max-w-prose text-muted-foreground text-sm">{t("lead")}</p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <span className="text-muted-foreground text-sm">{t("overall")}</span>
          <span className="font-medium text-heading-32 tabular-nums" data-numeric>
            {percent(score.overall)}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {t("counted", { rated: score.rated, total: score.total })}
          </span>
        </div>
      </div>

      <Table density="compact">
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.section")}</TableHead>
            <TableHead className="text-right">{t("columns.rated")}</TableHead>
            <TableHead className="text-right">{t("columns.percent")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {score.sections.map((section) => (
            <TableRow key={section.key}>
              <TableCell>
                <span className="font-mono text-muted-foreground text-xs" translate="no">
                  {section.label}
                </span>{" "}
                {section.title[locale]}
                {section.excluded && section.exclusionNote ? (
                  <span className="block whitespace-normal text-muted-foreground text-xs">
                    {section.exclusionNote}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums" data-numeric>
                {section.excluded
                  ? t("excluded")
                  : t("ratedOf", { rated: section.rated, total: section.total })}
              </TableCell>
              <TableCell className="text-right tabular-nums" data-numeric>
                {section.excluded ? "—" : percent(section.percent)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-3">
        <h3 className="font-medium text-base">{t("gaps")}</h3>
        {gaps.length === 0 ? <p className="text-muted-foreground text-sm">{t("noGaps")}</p> : null}
        {gaps.length > 0 || excluded.length > 0 ? (
          <ol className="flex flex-col gap-3" data-gap-list>
            {gaps.map((gap) => (
              <li key={gap.itemId} className="flex flex-col gap-1.5 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={gap.rating === "non_compliant" ? "destructive" : "warning"}>
                    {t(`ratings.${gap.rating}`)}
                  </Badge>
                  <span className="font-mono text-muted-foreground text-xs" translate="no">
                    {gap.label}
                  </span>
                  <span className="font-medium text-sm">{gap.title[locale]}</span>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("inSection", { label: gap.sectionLabel, title: gap.sectionTitle[locale] })}
                </p>
                {gap.note ? <p className="whitespace-pre-wrap text-sm">{gap.note}</p> : null}
              </li>
            ))}
            {/* AC-8: a standard marked not applicable is listed after the rated gaps, with its
                reason, so the list says why a whole section is missing from the score. */}
            {excluded.map((section) => (
              <li
                key={`excluded-${section.key}`}
                data-excluded-section={section.key}
                className="flex flex-col gap-1.5 rounded-lg border border-dashed p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t("excluded")}</Badge>
                  <span className="font-mono text-muted-foreground text-xs" translate="no">
                    {section.label}
                  </span>
                  <span className="font-medium text-sm">{section.title[locale]}</span>
                </div>
                <p className="text-muted-foreground text-xs">{t("excludedEntry")}</p>
                {section.exclusionNote ? (
                  <p className="whitespace-pre-wrap text-sm">{section.exclusionNote}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </section>
  );
}
