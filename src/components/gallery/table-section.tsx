import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
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

const ROWS = [
  { company: "Muster AG", canton: "ZH", kpi: "12 480.00", level: "low" },
  { company: "Alpenchemie Holding SA", canton: "VD", kpi: "1 045.50", level: "high" },
  { company: "Rhein Logistik GmbH", canton: "BS", kpi: "980 210.75", level: "medium" },
] as const;

/**
 * Tables in both densities with a truncated cell that carries its full text in a tooltip on hover
 * and on focus (AC-6, AC-10). Server component; the tooltip trigger is the interactive part.
 */
export function TableSection() {
  const t = useTranslations("gallery.table");
  return (
    <div className="flex flex-col gap-12">
      <Example label={t("default")}>
        <DemoTable density="default" />
      </Example>
      <Example label={t("compact")}>
        <DemoTable density="compact" />
      </Example>
    </div>
  );
}

function DemoTable({ density }: { density: "default" | "compact" }) {
  const t = useTranslations("gallery.table");
  const badges = useTranslations("gallery.buttons.badge");
  const longText = t("longText");
  return (
    <div className="w-full rounded-lg border">
      <Table density={density} data-testid={`table-${density}`}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.company")}</TableHead>
            <TableHead>{t("columns.canton")}</TableHead>
            <TableHead className="text-right">{t("columns.kpi")}</TableHead>
            <TableHead>{t("columns.level")}</TableHead>
            <TableHead>{t("columns.note")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row) => (
            <TableRow key={row.company}>
              <TableCell className="font-medium">{row.company}</TableCell>
              <TableCell>{row.canton}</TableCell>
              <TableCell className="text-right tabular-nums" data-numeric>
                {row.kpi}
              </TableCell>
              <TableCell>
                <Badge variant={row.level}>{badges(row.level)}</Badge>
              </TableCell>
              <TableCell className="max-w-48">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="block w-full cursor-default truncate rounded-sm text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      data-testid="truncated-cell"
                    >
                      {longText}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{longText}</TooltipContent>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
