import { ExternalLinkIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import type { AssumptionRow, ParsedSnapshot } from "@/features/benchmark/queries";
import { KPI_CATALOGUE } from "@/features/research/catalogue";
import type { KpiDefinitionRow } from "@/features/research/queries";
import { localizedText } from "@/features/research/ui/kpi-table";
import type { LocaleCode } from "@/i18n/routing";
import { formatKpiValue } from "./format";

export type CalculationContentProps = {
  readonly snapshot: ParsedSnapshot;
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly assumptions: readonly AssumptionRow[];
  readonly locale: LocaleCode;
};

/**
 * The body of "How this is calculated" (spec 0008, AC-10): the formula in words, every
 * assumption the snapshot used with its value, unit, source and provisional mark, the fixed FTE
 * line, and the inputs used (per KPI the value, year, source kind, peer rung and year; the
 * headcount; the section and band). Everything is read from the snapshot's blocks; the labels
 * come from `benchmark_assumptions.label` and `kpi_definitions.name`. Server component.
 */
export async function CalculationContent({
  snapshot,
  catalogue,
  assumptions,
  locale,
}: CalculationContentProps) {
  const t = await getTranslations("benchmark");
  const research = await getTranslations("research.table");
  const format = await getFormatter();
  const yesNo = { yes: research("yes"), no: research("no") };
  const { inputs, results } = snapshot.blocks;
  const labelOf = (key: string) => {
    const row = assumptions.find((assumption) => assumption.key === key);
    return (row ? localizedText(row.label, locale) : "") || key;
  };
  const kpiNameOf = (key: string) => {
    const definition = catalogue.find((entry) => entry.key === key);
    return (definition ? localizedText(definition.name, locale) : "") || key;
  };
  const sectionName = (section: string) =>
    section === "ALL" ? t("positions.allIndustries") : t(`noga.sections.${section as "A"}`);
  const division = inputs.industryCode?.match(/^(\d{2})/)?.[1];

  return (
    <div className="flex flex-col gap-6 text-sm" data-calculation-content>
      <section className="flex flex-col gap-2">
        <h4 className="font-semibold">{t("disclosure.formulaTitle")}</h4>
        <p className="max-w-prose text-muted-foreground">{t("disclosure.formula")}</p>
        <p className="max-w-prose text-muted-foreground" data-fte-line>
          {t("disclosure.fteLine")}
        </p>
      </section>

      <section
        className="flex flex-col gap-2"
        data-assumptions={snapshot.blocks.assumptions.length}
      >
        <h4 className="font-semibold">{t("disclosure.assumptionsTitle")}</h4>
        {snapshot.blocks.assumptions.length === 0 ? (
          <p className="text-muted-foreground">{t("disclosure.noCost")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {snapshot.blocks.assumptions.map((assumption) => (
              <li
                key={assumption.key}
                className="flex flex-col gap-0.5 rounded-md border px-3 py-2"
                data-assumption={assumption.key}
                data-assumption-value={assumption.value}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{labelOf(assumption.key)}</span>
                  <span className="tabular-nums" data-numeric>
                    {format.number(assumption.value, { maximumFractionDigits: 2 })}{" "}
                    {assumption.unit}
                  </span>
                  {assumption.provisional ? (
                    <Badge variant="outline" data-provisional>
                      {t("disclosure.provisional")}
                    </Badge>
                  ) : null}
                </div>
                <span className="text-muted-foreground text-xs">
                  {assumption.sourceUrl ? (
                    <a
                      href={assumption.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 underline underline-offset-2"
                    >
                      {assumption.sourceName}
                      <ExternalLinkIcon className="size-3" aria-hidden="true" />
                    </a>
                  ) : (
                    assumption.sourceName
                  )}
                  {" · "}
                  {t("disclosure.effectiveFrom", {
                    date: format.dateTime(new Date(assumption.effectiveFrom), "dateShort"),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h4 className="font-semibold">{t("disclosure.inputsTitle")}</h4>
        <ul className="flex flex-col gap-1 text-muted-foreground" data-inputs>
          <li data-input-headcount={inputs.fte ?? ""}>
            {inputs.fte
              ? t("disclosure.headcount", { count: format.number(inputs.fte, "integer") })
              : t("disclosure.noHeadcount")}
          </li>
          <li data-input-industry={inputs.industryCode ?? ""}>
            {division && inputs.section
              ? t("disclosure.industry", {
                  division: `${division} · ${t(`noga.divisions.${division as "01"}`)}`,
                  section: inputs.section,
                  band: t(`sizeBands.${inputs.sizeBand}`),
                })
              : t("disclosure.noIndustry", { band: t(`sizeBands.${inputs.sizeBand}`) })}
          </li>
          {inputs.kpis.map((input) => {
            const peer = results.find((result) => result.key === input.key)?.peer ?? null;
            return (
              <li key={input.key} data-input-kpi={input.key}>
                <span className="text-foreground">{kpiNameOf(input.key)}</span>
                {": "}
                {t("disclosure.inputValue", {
                  value: formatKpiValue(
                    input.value,
                    KPI_CATALOGUE[input.key].format,
                    format,
                    yesNo,
                  ),
                  year: input.periodYear,
                  source:
                    input.source === "client"
                      ? t("disclosure.sourceClient")
                      : t("disclosure.sourceResearch"),
                })}
                {" · "}
                {peer
                  ? t("disclosure.peerUsed", {
                      section: sectionName(peer.industrySection),
                      band: t(`sizeBands.${peer.sizeBand}`),
                      year: peer.periodYear,
                    })
                  : t("disclosure.noPeerUsed")}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
