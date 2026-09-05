import { getFormatter, getTranslations } from "next-intl/server";
import { Example } from "@/components/gallery/gallery-section";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formats } from "@/i18n/formats";

/** A fixed instant so the section reads the same on every render: 4 September 2026, 13:05 UTC. */
const SAMPLE_DATE = new Date("2026-09-04T13:05:00Z");
const NUMBER_SAMPLES = { chf: 4900, chfWhole: 48312.5, percent: 0.1234, integer: 1234567 } as const;
const DATE_FORMATS = Object.keys(formats.dateTime) as ReadonlyArray<keyof typeof formats.dateTime>;
const NUMBER_FORMATS = Object.keys(formats.number) as ReadonlyArray<keyof typeof formats.number>;

/**
 * Every named format rendered live through the request formatter (spec 0004, AC-3): the table is
 * the visual check that CHF, dates and percentages read the Swiss way in the active language.
 * Server component on the ops only gallery.
 */
export async function FormattingSection() {
  const t = await getTranslations("gallery.formatting");
  const format = await getFormatter();

  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <Example label={t("numbers")}>
        <div className="w-full rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.format")}</TableHead>
                <TableHead>{t("columns.input")}</TableHead>
                <TableHead>{t("columns.output")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {NUMBER_FORMATS.map((name) => (
                <TableRow key={name}>
                  <TableCell className="font-mono text-xs">{name}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums" data-numeric>
                    {String(NUMBER_SAMPLES[name])}
                  </TableCell>
                  <TableCell className="tabular-nums" data-numeric data-format={name}>
                    {format.number(NUMBER_SAMPLES[name], name)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Example>
      <Example label={t("dates")}>
        <div className="w-full rounded-lg border">
          <Table density="compact">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.format")}</TableHead>
                <TableHead>{t("columns.input")}</TableHead>
                <TableHead>{t("columns.output")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DATE_FORMATS.map((name) => (
                <TableRow key={name}>
                  <TableCell className="font-mono text-xs">{name}</TableCell>
                  <TableCell className="font-mono text-xs tabular-nums" data-numeric>
                    {SAMPLE_DATE.toISOString()}
                  </TableCell>
                  <TableCell className="tabular-nums" data-numeric data-format={name}>
                    {format.dateTime(SAMPLE_DATE, name)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Example>
    </div>
  );
}
