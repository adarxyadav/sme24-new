"use client";

import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";
import { QuartileBand } from "@/components/ui/quartile-band";

/** The three shapes of the band: inside the top quarter, below the median, beyond p75. */
const BANDS = [
  { key: "bandTop", p25: 34.9, median: 49.9, p75: 66.4, value: 30 },
  { key: "bandBelow", p25: 34.9, median: 49.9, p75: 66.4, value: 58 },
  { key: "bandOutside", p25: 34.9, median: 49.9, p75: 66.4, value: 68 },
] as const;

/**
 * The benchmark primitives (spec 0008, AC-14): the `QuartileBand` in three shapes and the point
 * comparison beside them, so axe scans both on the gallery. The opportunity card and the Peer
 * Standing card went with the cost model and the curated library (spec 0022, AC-12); the peer
 * table, the loss card and the package card of `benchmark-model@7` join this section with the page
 * itself. Runs in the browser.
 */
export function BenchmarkSection() {
  const t = useTranslations("gallery.benchmark");
  const b = useTranslations("benchmark");

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
    </div>
  );
}
