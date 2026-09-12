"use client";

import { ChevronDownIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Example } from "@/components/gallery/gallery-section";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { QuartileBand } from "@/components/ui/quartile-band";
import { Separator } from "@/components/ui/separator";

/** The three shapes of the band: inside the top quarter, below the median, beyond p75. */
const BANDS = [
  { key: "bandTop", p25: 34.9, median: 49.9, p75: 66.4, value: 30 },
  { key: "bandBelow", p25: 34.9, median: 49.9, p75: 66.4, value: 58 },
  { key: "bandOutside", p25: 34.9, median: 49.9, p75: 66.4, value: 68 },
] as const;

/**
 * The benchmark primitives (spec 0008, AC-14): the `QuartileBand` in three shapes, a static
 * opportunity card in its cut down shape (the confidence spelled out in the title row, the range,
 * the working estimate with its lost time clause, a saving and an "already at or below" mark),
 * and the `Collapsible` disclosure, so axe scans them on the gallery. Runs in the browser.
 */
export function BenchmarkSection() {
  const t = useTranslations("gallery.benchmark");
  const b = useTranslations("benchmark");
  const format = useFormatter();
  const [open, setOpen] = useState(false);
  const chf = (value: number) => format.number(value, "chfWhole");

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
            <p className="text-muted-foreground text-xs tabular-nums" data-numeric>
              {b("positions.quartiles", { p25: band.p25, median: band.median, p75: band.p75 })}
            </p>
          </Example>
        ))}
      </div>
      {/* The point comparison beside the three band shapes (spec 0016, AC-16): a peer row holding
          one figure gets no band and no replacement graphic, so axe scans that state too. */}
      <div className="grid gap-8 lg:grid-cols-3">
        <Example label={t("pointComparison")}>
          <span className="text-sm">{b("positions.band.above_average")}</span>
          <p className="text-muted-foreground text-xs tabular-nums" data-numeric>
            {b("positions.sector", { value: "44.30" })}
          </p>
          <p className="text-muted-foreground text-xs">{b("positions.pointBasis")}</p>
        </Example>
      </div>
      <div className="grid gap-8 lg:grid-cols-2">
        <Example label={t("card")}>
          <Card>
            <CardHeader>
              <CardTitle>{b("card.title")}</CardTitle>
              <CardAction>
                <Badge variant="warning">{b("card.confidence.medium")}</Badge>
              </CardAction>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <p className="font-semibold text-3xl tabular-nums" data-numeric>
                  {b("card.rangeHeadline", { low: chf(1_060_000), high: chf(2_651_000) })}
                </p>
                <p className="text-muted-foreground text-sm tabular-nums" data-numeric>
                  {b.rich("card.workingDerived", {
                    cost: chf(1_961_000),
                    count: format.number(1.8, "oneDecimal"),
                    fte: format.number(420, "integer"),
                    value: (chunks) => (
                      <span className="font-medium text-foreground">{chunks}</span>
                    ),
                  })}
                </p>
              </div>
              <Separator />
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-label-13 text-muted-foreground">{b("card.savingMedian")}</dt>
                  <dd className="text-muted-foreground text-sm tabular-nums" data-numeric>
                    {b.rich("card.savingValue", {
                      amount: chf(522_000),
                      value: (chunks) => (
                        <span className="font-medium text-foreground text-lg">{chunks}</span>
                      ),
                    })}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-label-13 text-muted-foreground">{b("card.savingTop")}</dt>
                  <dd className="text-sm">{b("card.atOrBelow")}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </Example>
        <Example label={t("collapsible")}>
          <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left font-medium text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {b("disclosure.title")}
              <ChevronDownIcon
                aria-hidden="true"
                className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
              />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-4 py-4 text-muted-foreground text-sm">
              {b("disclosure.fteLine")}
            </CollapsibleContent>
          </Collapsible>
        </Example>
      </div>
    </div>
  );
}
