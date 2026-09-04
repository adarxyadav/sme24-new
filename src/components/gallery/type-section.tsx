import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";

/**
 * The type hierarchy (brand guidelines, section 03; spec 0003, AC-2): Geist in five roles,
 * Geist Mono for identifiers, tabular figures for numbers. Server.
 */
export function TypeSection() {
  const t = useTranslations("gallery.type");
  return (
    <div className="flex flex-col gap-8">
      <Example label="display · text-display-lg · 800 · −3%">
        <p className="text-display-lg">{t("display")}</p>
      </Example>
      <Example label="display · text-display · 800 · −3%">
        <p className="text-display">{t("display")}</p>
      </Example>
      <Example label="display · text-display-sm · 800 · −3%">
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
    </div>
  );
}
