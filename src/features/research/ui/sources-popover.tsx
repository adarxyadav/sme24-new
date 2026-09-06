"use client";

import { LinkIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { KpiSource } from "@/features/research/summary";

export type SourcesPopoverProps = {
  readonly kpiName: string;
  readonly year: number;
  readonly sources: readonly KpiSource[];
};

/** The sources of one KPI value (AC-7): title, link and excerpt in a popover under the cell. Browser. */
export function SourcesPopover({ kpiName, year, sources }: SourcesPopoverProps) {
  const t = useTranslations("research");
  const format = useFormatter();
  const label = t("table.sourcesFor", { kpi: kpiName, year });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-label={label} className="h-6 px-1.5 text-xs">
          <LinkIcon data-icon="inline-start" aria-hidden="true" />
          {t("table.openSources", { count: sources.length })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)]" align="start">
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>{t("sources.description")}</PopoverDescription>
        </PopoverHeader>
        <ul className="flex max-h-80 flex-col gap-3 overflow-y-auto pt-3 text-sm">
          {sources.map((source) => (
            <li key={`${source.url}|${source.excerpt}`} className="flex flex-col gap-1">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline underline-offset-4"
              >
                {source.title || source.url}
              </a>
              <p className="text-muted-foreground text-xs">
                {source.excerpt ? `“${source.excerpt}”` : t("table.noExcerpt")}
              </p>
              <p className="text-muted-foreground text-xs">
                {t("sources.retrieved", {
                  time: format.dateTime(new Date(source.retrievedAt), "dateShort"),
                })}
              </p>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
