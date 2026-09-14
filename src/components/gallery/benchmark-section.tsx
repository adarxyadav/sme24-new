"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { Badge } from "@/components/ui/badge";
import { QuartileBand } from "@/components/ui/quartile-band";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** The three shapes of the band: inside the top quarter, below the median, beyond p75. */
const BANDS = [
  { key: "bandTop", p25: 34.9, median: 49.9, p75: 66.4, value: 30 },
  { key: "bandBelow", p25: 34.9, median: 49.9, p75: 66.4, value: 58 },
  { key: "bandOutside", p25: 34.9, median: 49.9, p75: 66.4, value: 68 },
] as const;

/**
 * Three rows of the peer table in its three shapes (spec 0022, AC-20): a peer with both rates and a
 * headcount, a peer with neither headcount nor an estimated loss, and the client's own row
 * highlighted in place. Invented figures, so nothing here is read as a real company's.
 */
const PEER_ROWS = [
  { name: "Alpha AG", headcount: 1_200, year: 2024, ltifr: 2.4, trifr: 5.1, loss: 275_000 },
  { name: "Gamma GmbH", headcount: null, year: 2023, ltifr: 8.2, trifr: null, loss: null },
] as const;

/**
 * The sample company and country the rows carry. Invented data rather than copy, which is why they
 * live here and not in the catalogs: on the real page the name comes from `companies.name` and the
 * country from `Intl.DisplayNames`, so neither is ever a translated string.
 */
const SAMPLE_COUNTRY = "Switzerland";
const SAMPLE_COMPANY = "Musterfirma AG";

/**
 * The benchmark primitives on the gallery, so axe scans each of them on every run.
 *
 * The `QuartileBand` in three shapes stays: it is the marketing cost iceberg's own graphic, the one
 * place the quartile vocabulary still lives (spec 0016). Beside it are the three shapes of the peer
 * table row and the derived counts of the loss card, the two pieces `benchmark-model@7` put on the
 * client page (spec 0022, AC-20, AC-21). The opportunity card and the Peer Standing card went with
 * the cost model and the curated library (AC-12).
 *
 * A client section, like every other one here; the page hands it the namespaces it reads. Browser.
 */
export function BenchmarkSection() {
  const t = useTranslations("gallery.benchmark");
  const b = useTranslations("benchmark");
  const format = useFormatter();
  const money = (value: number) =>
    format.number(value, { style: "currency", currency: "CHF", maximumFractionDigits: 0 });
  const rate = (value: number | null) =>
    value === null
      ? b("peers.table.none")
      : format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-12">
      <div className="grid gap-8 lg:grid-cols-3">
        {BANDS.map((band) => (
          <Example key={band.key} label={t(band.key)}>
            <QuartileBand
              p25={band.p25}
              median={band.median}
              p75={band.p75}
              value={band.value}
              label={t("bandLabel", { value: band.value })}
            />
          </Example>
        ))}
      </div>

      {/* The one merged peer table (AC-20): the badge, the rank sentence, the three row shapes and
          the footnote, so the whole block is scanned rather than a cell of it. */}
      <Example label={t("peerTable")}>
        <div className="flex w-full flex-col gap-4">
          <Badge variant="secondary">
            {b("peers.badge", {
              count: 3,
              scope: b("peers.rung.country", { country: SAMPLE_COUNTRY }),
            })}
          </Badge>
          <p className="max-w-prose text-sm">
            {b("peers.rank.both", {
              industry: b("noga.sections.C"),
              scope: b("peers.rung.country", { country: SAMPLE_COUNTRY }),
              ltifrRank: 3,
              ltifrOf: 4,
              trifrRank: 3,
              trifrOf: 4,
            })}
          </p>
          <div className="w-full overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">{b("peers.table.company")}</TableHead>
                  <TableHead scope="col">{b("peers.table.country")}</TableHead>
                  <TableHead scope="col">{b("peers.table.year")}</TableHead>
                  <TableHead scope="col" className="text-right">
                    {b("peers.table.ltifr")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {b("peers.table.trifr")}
                  </TableHead>
                  <TableHead scope="col" className="text-right">
                    {b("peers.table.loss")}
                  </TableHead>
                  <TableHead scope="col">{b("peers.table.source")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PEER_ROWS.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="align-top whitespace-normal">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{row.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {row.headcount === null
                            ? b("peers.table.noHeadcount")
                            : b("peers.table.headcount", {
                                n: format.number(row.headcount, "integer"),
                              })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">{SAMPLE_COUNTRY}</TableCell>
                    <TableCell className="align-top tabular-nums" data-numeric>
                      {row.year}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums" data-numeric>
                      {rate(row.ltifr)}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums" data-numeric>
                      {rate(row.trifr)}
                    </TableCell>
                    <TableCell className="align-top text-right tabular-nums" data-numeric>
                      {row.loss === null ? b("peers.table.none") : money(row.loss)}
                    </TableCell>
                    <TableCell className="align-top">
                      <a
                        href="https://example.org/report"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                      >
                        {b("peers.table.source")}
                      </a>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/60">
                  <TableCell className="align-top whitespace-normal">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">{SAMPLE_COMPANY}</span>
                      <span className="text-muted-foreground text-xs">
                        {b("peers.table.headcount", { n: format.number(500, "integer") })}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="align-top">{SAMPLE_COUNTRY}</TableCell>
                  <TableCell className="align-top text-muted-foreground">
                    {b("peers.table.none")}
                  </TableCell>
                  <TableCell className="align-top text-right font-medium tabular-nums" data-numeric>
                    {rate(6)}
                  </TableCell>
                  <TableCell className="align-top text-right font-medium tabular-nums" data-numeric>
                    {rate(10)}
                  </TableCell>
                  <TableCell className="align-top text-right font-medium tabular-nums" data-numeric>
                    {money(365_715)}
                  </TableCell>
                  <TableCell className="align-top">
                    <Badge variant="secondary">{b("peers.table.you")}</Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
          <p className="max-w-prose text-muted-foreground text-xs">{b("peers.footnote")}</p>
        </div>
      </Example>

      {/* The loss card's headline and its three derived counts (AC-21), each with its badge. */}
      <Example label={t("lossCard")}>
        <div className="flex flex-col gap-4">
          <p className="font-semibold text-3xl tabular-nums" data-numeric>
            {b("loss.headline", { amount: money(365_715) })}
          </p>
          <p className="text-sm">{b("loss.savingAtMedian", { amount: money(90_248) })}</p>
          <ul className="flex flex-col gap-2">
            {[
              b("loss.counts.ltis", { count: format.number(5.4, "oneDecimal") }),
              b("loss.counts.recordables", { count: format.number(3.6, "oneDecimal") }),
              b("loss.counts.fatalities", { count: 0 }),
            ].map((label) => (
              <li key={label} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tabular-nums" data-numeric>
                  {label}
                </span>
                <Badge variant="outline">{b("loss.counts.calculated")}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </Example>
    </div>
  );
}
