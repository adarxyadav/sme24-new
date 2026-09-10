import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * Where the bar sits: the company's own accident rate as a share of the peer band it is measured
 * against. The worked example the page already commits to (`marketing.landing.points.sentence`) is
 * a 120 person metal fabricator at UVG section C's p75 of 66.4 against a median of 49.9, so the
 * bar reads three quarters along -- the same arithmetic that produces the CHF 148 000 the card
 * prints and the sentence higher up the page quotes.
 */
const RATE_SHARE = 75;

/**
 * A still of the dashboard's benchmark result, drawn from the product's own `Card`, `Progress` and
 * `Button`, so the page shows the product rather than describing it.
 *
 * The figure is the one the landing page already stands behind, not a number chosen to look good:
 * it is the same CHF 148 000 the worked example band quotes, computed by the real model from the
 * seed assumptions. A still that printed a different gap for the same example company would
 * contradict the sentence two sections above it.
 *
 * Like `LookupCard` it is the picture only, and neither hides itself from assistive tech nor
 * leaves the tab order: both belong to whatever frames it, because only the caller knows what the
 * whole picture is of.
 */
export function BenchmarkCard({ className }: { readonly className?: string }) {
  const t = useTranslations("marketing.landing.how.benchmarkCard");

  return (
    <Card className={cn(className)}>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" tabIndex={-1}>
            {t("action")}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {/* The franc figure leads, per docs/marketing.md: both buyers are in play and the CFO is
            reading for the number. `tabular-nums` and `data-numeric` per docs/design.md. */}
        <p className="flex items-baseline gap-2">
          <span className="font-semibold text-2xl tabular-nums" data-numeric>
            {t("figure")}
          </span>
          <span className="text-muted-foreground text-sm">{t("unit")}</span>
        </p>
        <div className="flex flex-col gap-1.5">
          <Progress value={RATE_SHARE} aria-label={t("progressLabel")} />
          {/* The bar's two ends named, so it reports a comparison rather than a bare proportion:
              a progress bar with no scale beside it reads as "75% complete", which is the one
              thing this figure does not mean. */}
          <p className="flex justify-between text-muted-foreground text-xs">
            <span>{t("you")}</span>
            <span>{t("peer")}</span>
          </p>
        </div>
      </CardContent>
      <CardFooter className="text-muted-foreground text-xs">{t("footer")}</CardFooter>
    </Card>
  );
}
