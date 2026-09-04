"use client";

import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Example } from "@/components/gallery/gallery-section";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";

const DATA = [
  { month: "m1", assessments: 12, findings: 31 },
  { month: "m2", assessments: 18, findings: 27 },
  { month: "m3", assessments: 15, findings: 22 },
  { month: "m4", assessments: 24, findings: 19 },
  { month: "m5", assessments: 21, findings: 16 },
  { month: "m6", assessments: 27, findings: 12 },
] as const;

/**
 * A bar and a line chart on the chart tokens with a themed tooltip and legend (AC-9). Recharts
 * renders in the browser only, so this section is a client component.
 */
export function ChartsSection() {
  const t = useTranslations("gallery.charts");
  const config: ChartConfig = {
    assessments: { label: t("assessments"), color: "var(--chart-1)" },
    findings: { label: t("findings"), color: "var(--chart-3)" },
  };
  const data = DATA.map((row) => ({ ...row, label: t(`months.${row.month}`) }));

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <Example label={t("bar")}>
        <ChartContainer config={config} className="h-64 w-full">
          <BarChart data={data} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="assessments" fill="var(--color-assessments)" radius={4} />
            <Bar dataKey="findings" fill="var(--color-findings)" radius={4} />
          </BarChart>
        </ChartContainer>
      </Example>
      <Example label={t("line")}>
        <ChartContainer config={config} className="h-64 w-full">
          <LineChart data={data} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="assessments"
              stroke="var(--color-assessments)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="findings"
              stroke="var(--color-findings)"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </Example>
    </div>
  );
}
