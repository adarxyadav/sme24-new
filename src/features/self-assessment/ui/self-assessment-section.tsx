import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { isKpiKey, KPI_CATALOGUE } from "@/features/research/catalogue";
import type { KpiDefinitionRow, KpiRow } from "@/features/research/queries";
import { localizedText } from "@/features/research/ui/kpi-table";
import type { LocaleCode } from "@/i18n/routing";
import { KpiForm, type KpiFormField } from "./kpi-form";

export type SelfAssessmentSectionProps = {
  readonly companyId: string;
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly rows: readonly KpiRow[];
  readonly currentYear: number;
  readonly locale: LocaleCode;
};

/** The catalogue rows as form fields: the localized name and description, the unit and the format. Pure. */
export function formFields(
  catalogue: readonly KpiDefinitionRow[],
  locale: LocaleCode,
): readonly KpiFormField[] {
  return catalogue.flatMap((definition) =>
    isKpiKey(definition.key)
      ? [
          {
            key: definition.key,
            name: localizedText(definition.name, locale) || definition.key,
            description: localizedText(definition.description, locale),
            unit: definition.unit,
            format: KPI_CATALOGUE[definition.key].format,
          },
        ]
      : [],
  );
}

/**
 * The "Your figures" section of the dashboard (spec 0010, AC-1): one card holding the client KPI
 * form, rendered whenever the organization has a company, in every run state. Server component.
 */
export async function SelfAssessmentSection({
  companyId,
  catalogue,
  rows,
  currentYear,
  locale,
}: SelfAssessmentSectionProps) {
  const t = await getTranslations("selfAssessment");
  return (
    <section
      aria-labelledby="self-assessment-heading"
      className="flex flex-col gap-4"
      data-self-assessment
    >
      <div className="flex flex-col gap-1">
        <h2 id="self-assessment-heading" className="font-semibold text-lg">
          {t("heading")}
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <Card>
        <CardContent>
          <KpiForm
            companyId={companyId}
            fields={formFields(catalogue, locale)}
            rows={rows}
            currentYear={currentYear}
          />
        </CardContent>
      </Card>
    </section>
  );
}
