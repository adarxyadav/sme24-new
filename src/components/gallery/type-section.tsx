import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";

/*
 * Every class is written out in full rather than built as `text-heading-${size}`. Tailwind v4 scans
 * source files for literal strings, so an interpolated name produces no CSS at all and the row
 * would render at the inherited body size -- silently, and identically for every size, which is the
 * hardest kind of wrong to notice on a gallery whose whole job is showing what the sizes look like.
 * The size is derived from the class name here, so the two can never disagree.
 */
const HEADINGS = [
  "text-heading-72",
  "text-heading-64",
  "text-heading-56",
  "text-heading-48",
  "text-heading-40",
  "text-heading-32",
  "text-heading-24",
  "text-heading-20",
  "text-heading-16",
  "text-heading-14",
] as const;
const COPY = [
  "text-copy-24",
  "text-copy-20",
  "text-copy-18",
  "text-copy-16",
  "text-copy-14",
  "text-copy-13",
] as const;
const LABELS = [
  "text-label-20",
  "text-label-18",
  "text-label-16",
  "text-label-14",
  "text-label-13",
  "text-label-12",
] as const;
const BUTTONS = ["text-button-16", "text-button-14", "text-button-12"] as const;
const MONO = [
  "text-copy-13-mono",
  "text-label-14-mono",
  "text-label-13-mono",
  "text-label-12-mono",
] as const;

/** The pixel size a scale class is named after, for the sample text. Server. */
function sizeOf(className: string): string {
  return className.split("-")[2] ?? "";
}

/**
 * One row of the scale table: the size rendered at its own class, the class name, and what it is
 * for. Server.
 */
function Row({
  className,
  name,
  usage,
  sample,
}: {
  className: string;
  name: string;
  usage: string;
  sample: string;
}) {
  return (
    <tr className="border-border border-b last:border-0">
      <td className="py-3 pr-6 align-middle">
        <span className={className}>{sample}</span>
      </td>
      <td className="py-3 pr-6 align-middle">
        <code className="text-label-13-mono text-muted-foreground">{name}</code>
      </td>
      <td className="py-3 align-middle text-muted-foreground text-xs">{usage}</td>
    </tr>
  );
}

/**
 * One family of the Geist scale as a table: example, class name, usage. The caption carries the
 * family's rule, so the table is readable on its own. Server.
 */
function Family({
  title,
  rule,
  rows,
}: {
  title: string;
  rule: string;
  rows: readonly { className: string; name: string; usage: string; sample: string }[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-heading-20">{title}</h3>
        <p className="max-w-prose text-muted-foreground text-xs">{rule}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-left">
          <tbody>
            {rows.map((row) => (
              <Row key={row.name} {...row} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * The type hierarchy (brand guidelines, section 03; spec 0003, AC-2): Geist in five roles,
 * Geist Mono for identifiers, tabular figures for numbers, plus the four family Geist scale
 * adapted 2026-09-09 (docs/design.md, "The scale"). Server.
 */
export function TypeSection() {
  const t = useTranslations("gallery.type");
  return (
    <div className="flex flex-col gap-12">
      <Example label="display · text-display-lg · 450 · −3%">
        <p className="text-display-lg">{t("display")}</p>
      </Example>
      <Example label="display · text-display · 450 · −3%">
        <p className="text-display">{t("display")}</p>
      </Example>
      <Example label="display · text-display-sm · 450 · −3%">
        <p className="text-display-sm">{t("display")}</p>
      </Example>
      <Example label="headline · h1 · text-2xl font-bold tracking-headline · 700 · −2%">
        <p className="font-bold text-2xl tracking-headline">{t("headline")}</p>
      </Example>
      <Example label="subhead · h2 · text-lg font-semibold · 600">
        <p className="font-semibold text-lg">{t("subhead")}</p>
      </Example>
      <Example label="card title · text-base font-semibold">
        <p className="font-semibold text-base">{t("subhead")}</p>
      </Example>
      <Example label="body · text-sm · 400">
        <p className="max-w-prose text-sm">{t("body")}</p>
      </Example>
      <Example label="secondary · text-xs text-muted-foreground">
        <p className="max-w-prose text-muted-foreground text-xs">{t("body")}</p>
      </Example>
      <Example label="caption · eyebrow · 500 · caps · tracking-caps">
        <p className="eyebrow text-muted-foreground">{t("caption")}</p>
      </Example>
      <Example label="mono · font-mono text-xs">
        <code className="font-mono text-xs">run_01j9k3x7z2 · CHF-2026-0042</code>
      </Example>
      <Example label="figures · tabular-nums">
        <dl className="grid grid-cols-2 gap-x-6 font-mono text-sm tabular-nums">
          <dt className="text-muted-foreground">CHF</dt>
          <dd className="text-right">12 480.00</dd>
          <dt className="text-muted-foreground">CHF</dt>
          <dd className="text-right">1 045.50</dd>
          <dt className="text-muted-foreground">CHF</dt>
          <dd className="text-right">980 210.75</dd>
        </dl>
      </Example>

      <Family
        rows={HEADINGS.map((className) => ({
          className,
          name: className,
          usage: t("headingUsage"),
          sample: t("headingSample", { size: sizeOf(className) }),
        }))}
        rule={t("headingRule")}
        title={t("headings")}
      />
      <Family
        rows={COPY.map((className) => ({
          className,
          name: className,
          usage: t("copyUsage"),
          sample: t("copySample", { size: sizeOf(className) }),
        }))}
        rule={t("copyRule")}
        title={t("copy")}
      />
      <Family
        rows={LABELS.map((className) => ({
          className,
          name: className,
          usage: t("labelUsage"),
          sample: t("labelSample", { size: sizeOf(className) }),
        }))}
        rule={t("labelRule")}
        title={t("labels")}
      />
      <Family
        rows={BUTTONS.map((className) => ({
          className,
          name: className,
          usage: t("buttonUsage"),
          sample: t("buttonSample", { size: sizeOf(className) }),
        }))}
        rule={t("buttonRule")}
        title={t("buttons")}
      />
      <Family
        rows={MONO.map((name) => ({
          className: `${name} text-foreground`,
          name,
          usage: t("monoUsage"),
          sample: "run_01j9k3x7z2 · CHF-2026-0042",
        }))}
        rule={t("monoRule")}
        title={t("mono")}
      />

      <Example label="modifiers · nested strong and .subtle">
        <p className="text-copy-16">
          {t.rich("modifiers", {
            strong: (chunks) => <strong>{chunks}</strong>,
            subtle: (chunks) => <span className="subtle">{chunks}</span>,
          })}
        </p>
      </Example>
    </div>
  );
}
