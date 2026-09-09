import { Check, Database, Lock, MapPin, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Statement } from "@/components/brand/statement";
import { Button } from "@/components/ui/button";
import { PROCESSORS, type ProcessorRegion } from "@/features/legal/processors";
import { CornerBrackets } from "@/features/marketing/ui/corner-brackets";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** The three rows of the isolation object, and whether the fence lets each one through. */
const ISOLATION_ROWS = [
  { key: "yours", allowed: true },
  { key: "expert", allowed: true },
  { key: "other", allowed: false },
] as const;

/** The regions of the processor record, in the order the privacy page lists them. */
const REGIONS: readonly ProcessorRegion[] = ["ch", "eu", "us"];

/**
 * One panel of the band: on `lg` a subgrid spanning the list's three row tracks, so object,
 * heading and body line up across all three panels however tall each object is.
 */
const PANEL = "flex flex-col gap-5 px-6 py-7 lg:row-span-3 lg:grid lg:grid-rows-subgrid lg:gap-5";

/** The panel heading, one step under the step titles so the section heading keeps the weight. */
const PANEL_TITLE = "self-start text-pretty font-semibold text-lg tracking-headline";

/**
 * The residency object: the Zurich pin inside two rings, the way the reference band draws a
 * single centred glyph, with the place name on its own line under them. The name sits outside the
 * rings rather than in the innermost disc because it is wider than that disc at every breakpoint,
 * so centring it there crossed the ring on both sides. Decorative, so the rings are `aria-hidden`
 * and the meaning is carried by the tags and the body under it.
 */
function ResidencyObject({ badge }: { readonly badge: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-1">
      <div className="relative flex size-32 items-center justify-center sm:size-36">
        <div aria-hidden="true" className="absolute inset-0 rounded-full border border-dashed" />
        <div aria-hidden="true" className="absolute inset-4 rounded-full border sm:inset-5" />
        <div
          aria-hidden="true"
          className="absolute inset-9 rounded-full border bg-card sm:inset-10"
        />
        <MapPin aria-hidden="true" className="relative size-5" />
      </div>
      <span className="eyebrow text-muted-foreground">{badge}</span>
    </div>
  );
}

/**
 * The isolation object: three labelled rows, two through the fence and one stopped by it, so the
 * "one company, one fence" claim is shown rather than asserted. Each row states its outcome in
 * words next to the icon, so colour and shape are never the only carriers.
 */
function IsolationObject({
  rows,
  allowedLabel,
  deniedLabel,
  rootLabel,
}: {
  readonly rows: Readonly<Record<string, string>>;
  readonly allowedLabel: string;
  readonly deniedLabel: string;
  readonly rootLabel: string;
}) {
  return (
    <div className="flex flex-col items-center py-1">
      {/* The source of every row below it, so the panel shows a tree rather than a list. */}
      <p className="flex items-center gap-2 border bg-card px-3 py-2 text-sm">
        <Database aria-hidden="true" className="size-4 text-muted-foreground" />
        {rootLabel}
        <Lock aria-hidden="true" className="size-3 text-muted-foreground" />
      </p>
      <div aria-hidden="true" className="h-5 border-l border-dashed" />
      {/* The trunk: each row hangs off it on its own dashed branch drawn by `before`. */}
      <ul className="flex w-full flex-col gap-2.5 border-l border-dashed pl-4 lg:gap-3">
        {ISOLATION_ROWS.map((row) => (
          <li
            key={row.key}
            className={cn(
              "relative flex items-center justify-between gap-3 border px-3 py-2.5 text-sm before:absolute before:-left-4 before:top-1/2 before:w-4 before:border-t before:border-dashed",
              row.allowed ? "bg-card" : "border-dashed text-muted-foreground",
            )}
          >
            <span className="min-w-0 text-pretty">{rows[row.key]}</span>
            <span
              className={cn(
                "flex shrink-0 items-center gap-1.5 text-xs",
                row.allowed ? "text-success" : "text-muted-foreground",
              )}
            >
              {row.allowed ? (
                <Check aria-hidden="true" className="size-3.5" />
              ) : (
                <X aria-hidden="true" className="size-3.5" />
              )}
              {row.allowed ? allowedLabel : deniedLabel}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The record object: one ruled row per region saying what happens there, and how many companies
 * are involved. The counts are read from `PROCESSORS`, so the panel still cannot drift from the
 * stack, but the vendor names stay on the privacy page where a buyer doing due diligence looks
 * for them: a landing page reader wants the jurisdiction, not our supplier list.
 */
function RecordObject({
  regions,
  purposes,
  countLabel,
}: {
  readonly regions: Readonly<Record<string, string>>;
  readonly purposes: Readonly<Record<string, string>>;
  readonly countLabel: (count: number) => string;
}) {
  return (
    <div className="flex flex-col justify-center py-1">
      <dl className="divide-y border-y">
        {REGIONS.map((region) => {
          const count = PROCESSORS.filter((processor) => processor.region === region).length;
          return (
            <div key={region} className="grid gap-1 py-3">
              <dt className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-sm">{regions[region]}</span>
                <span className="shrink-0 text-muted-foreground text-xs" data-numeric>
                  {countLabel(count)}
                </span>
              </dt>
              <dd className="text-pretty text-muted-foreground text-xs">{purposes[region]}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/**
 * The trust band of the landing page (docs/design.md, tier map: major): what happens to the
 * safety data a client hands over, shown as three panels in one hairline grid, each opening with
 * a token drawn object above its own heading. Every claim is one this repo can back — the Zurich
 * Supabase instance, the row level security of spec 0002 and the generated processor record of
 * spec 0015 — and the panel counts are read from `PROCESSORS` rather than written in prose.
 * Server component; adds no client JavaScript to the page.
 */
export function TrustSection() {
  const t = useTranslations("marketing.landing.trust");

  return (
    <section
      aria-labelledby="trust-heading"
      className="dark relative border-b bg-background text-foreground"
    >
      {/*
          The ground: a soft radial lift from the centre, so the band reads as a lit surface
          rather than a flat fill. Drawn from `--foreground` so it inverts with the block rather
          than being a hard coded grey, and `pointer-events-none` so it never eats a click.
        */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--foreground)_5%,transparent),transparent_70%)]"
      />
      <div className="relative mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6 md:gap-10 md:py-16">
        {/*
            The trust band is the page's one inverse block (docs/design.md): a tonal break where
            the argument turns from what SME24 sells to what it does with what you hand over. The
            header is composed here rather than through `SectionHeader`, whose `major` tier is a
            deliberate two column split; this section centres instead, so the statement carries
            the width alone.
          */}
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
          <p className="eyebrow flex items-center gap-2 border px-3 py-1.5 text-muted-foreground">
            <Lock aria-hidden="true" className="size-3.5" />
            {t("eyebrow")}
          </p>
          <Statement
            as="h2"
            id="trust-heading"
            text={t("title")}
            className="text-display-sm md:text-display"
          />
          <p className="max-w-xl text-balance text-lg text-muted-foreground">{t("lead")}</p>
          <div>
            <Button asChild size="lg" variant="outline">
              <Link href="/privacy">
                <Lock data-icon="inline-start" aria-hidden="true" />
                {t("cta")}
              </Link>
            </Button>
          </div>
        </div>

        {/*
            The grid carries the same closed hairline `border` as the steps and packages
            sections, and four short corner brackets sit over it at a stronger value, so the band
            is framed like every other block while still reading as marked out at its corners. The
            brackets are decorative, so they are `aria-hidden` and sit in this wrapper rather than
            in the list, which must keep only its three `li` children for the panel count.

            Inside, the three row tracks (object, heading, body) are shared rather than per
            column: each panel is a `grid-rows-subgrid` spanning them, so the three headings sit
            on one baseline however tall the objects above them are. `flex` here would only
            stretch each panel to the row height and leave its heading wherever its own object
            ended, which is what makes a band like this read as assembled rather than drawn. The
            dividers turn with the layout: horizontal while the panels stack, vertical from `lg`.
          */}
        <div className="relative">
          <CornerBrackets />
          <ul
            aria-label={t("panelsLabel")}
            className="grid border divide-y divide-border/60 lg:grid-cols-3 lg:grid-rows-[auto_auto_1fr] lg:divide-x lg:divide-y-0"
          >
            <li className={PANEL}>
              <ResidencyObject badge={t("panels.residency.badge")} />
              <Statement as="h3" text={t("panels.residency.title")} className={PANEL_TITLE} />
              <p className="max-w-prose text-muted-foreground text-sm">
                {t("panels.residency.body")}
              </p>
            </li>

            <li className={PANEL}>
              <IsolationObject
                rows={{
                  yours: t("panels.isolation.rows.yours"),
                  expert: t("panels.isolation.rows.expert"),
                  other: t("panels.isolation.rows.other"),
                }}
                allowedLabel={t("panels.isolation.allowed")}
                deniedLabel={t("panels.isolation.denied")}
                rootLabel={t("panels.isolation.rootLabel")}
              />
              <Statement as="h3" text={t("panels.isolation.title")} className={PANEL_TITLE} />
              <p className="max-w-prose text-muted-foreground text-sm">
                {t("panels.isolation.body")}
              </p>
            </li>

            <li className={PANEL}>
              <RecordObject
                regions={{
                  ch: t("panels.record.regions.ch"),
                  eu: t("panels.record.regions.eu"),
                  us: t("panels.record.regions.us"),
                }}
                purposes={{
                  ch: t("panels.record.purposes.ch"),
                  eu: t("panels.record.purposes.eu"),
                  us: t("panels.record.purposes.us"),
                }}
                countLabel={(count) => t("panels.record.countLabel", { count })}
              />
              <Statement as="h3" text={t("panels.record.title")} className={PANEL_TITLE} />
              <p className="max-w-prose text-muted-foreground text-sm">{t("panels.record.body")}</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}
