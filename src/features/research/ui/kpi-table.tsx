import { InfoIcon } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isKpiKey, KPI_CATALOGUE, type KpiFormat } from "@/features/research/catalogue";
import type { DashboardKpi, KpiDefinitionRow } from "@/features/research/queries";
import { parseKpiSources } from "@/features/research/summary";
import type { LocaleCode } from "@/i18n/routing";
import { ConfidenceBadge } from "./badges";
import { SourcesPopover } from "./sources-popover";

export type KpiTableProps = {
  readonly catalogue: readonly KpiDefinitionRow[];
  readonly years: readonly number[];
  readonly kpis: readonly DashboardKpi[];
  readonly locale: LocaleCode;
};

/** The localized text of a `{de, en}` jsonb column. Pure. */
export function localizedText(value: unknown, locale: LocaleCode): string {
  if (!value || typeof value !== "object") return "";
  const text = (value as Record<string, unknown>)[locale];
  return typeof text === "string" ? text : "";
}

/**
 * The KPI table (spec 0007, AC-7): one row per catalogue KPI in sort order, one column per
 * reporting year, each cell with the formatted value, its confidence badge, its sources and a
 * "not verified" mark when the row's run skipped validation; "not found" for an empty cell, and
 * a coverage line. Server component.
 */
export async function KpiTable({ catalogue, years, kpis, locale }: KpiTableProps) {
  const t = await getTranslations("research.table");
  const format = await getFormatter();
  const byCell = new Map(kpis.map((row) => [`${row.kpi_key}:${row.period_year}`, row]));
  const found = new Set(kpis.map((row) => row.kpi_key));

  const render = (value: number, kind: KpiFormat): string => {
    switch (kind) {
      case "integer":
        return format.number(value, "integer");
      case "percent1":
        return format.number(value / 100, "percent");
      case "yesNo":
        return value >= 1 ? t("yes") : t("no");
      default:
        return format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm" data-coverage={found.size}>
        {t("coverage", { found: found.size, total: catalogue.length })}
      </p>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{t("kpi")}</TableHead>
              <TableHead scope="col">{t("unit")}</TableHead>
              {years.map((year) => (
                <TableHead key={year} scope="col" className="min-w-28 text-right">
                  {year}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalogue.map((definition) => {
              const name = localizedText(definition.name, locale) || definition.key;
              const description = localizedText(definition.description, locale);
              const kind = isKpiKey(definition.key)
                ? KPI_CATALOGUE[definition.key].format
                : "decimal2";
              return (
                <TableRow key={definition.key} data-kpi={definition.key}>
                  <TableCell className="min-w-56 max-w-xs align-top whitespace-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{name}</span>
                      {description ? (
                        <span className="text-muted-foreground text-xs">{description}</span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-muted-foreground text-xs">
                    {definition.unit}
                  </TableCell>
                  {years.map((year) => {
                    const row = byCell.get(`${definition.key}:${year}`);
                    if (!row || row.value === null) {
                      return (
                        <TableCell
                          key={year}
                          className="align-top text-right text-muted-foreground"
                        >
                          {t("notFound")}
                        </TableCell>
                      );
                    }
                    const sources = parseKpiSources(row.sources);
                    return (
                      <TableCell key={year} className="align-top text-right" data-year={year}>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="font-medium tabular-nums"
                            data-numeric
                            data-value={row.value}
                          >
                            {render(Number(row.value), kind)}
                          </span>
                          <div className="flex flex-wrap items-center justify-end gap-1">
                            {row.confidence !== null ? (
                              <ConfidenceBadge confidence={Number(row.confidence)} />
                            ) : null}
                            {row.validation === "skipped" ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" tabIndex={0} data-not-verified>
                                    <InfoIcon aria-hidden="true" />
                                    {t("notVerified")}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>{t("notVerifiedHint")}</TooltipContent>
                              </Tooltip>
                            ) : null}
                          </div>
                          {sources.length > 0 ? (
                            <SourcesPopover kpiName={name} year={year} sources={sources} />
                          ) : null}
                        </div>
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
