import { useTranslations } from "next-intl";
import { Example } from "@/components/gallery/gallery-section";

/** The type scale (spec 0003, AC-2): display sizes, app sizes, mono and tabular figures. Server. */
export function TypeSection() {
  const t = useTranslations("gallery.type");
  return (
    <div className="flex flex-col gap-8">
      <Example label="text-display-lg · font-semibold">
        <p className="font-semibold text-display-lg">{t("display")}</p>
      </Example>
      <Example label="text-display · font-semibold">
        <p className="font-semibold text-display">{t("display")}</p>
      </Example>
      <Example label="text-display-sm · font-semibold">
        <p className="font-semibold text-display-sm">{t("display")}</p>
      </Example>
      <Example label="h1 · text-2xl font-semibold tracking-tight">
        <p className="font-semibold text-2xl tracking-tight">{t("heading")}</p>
      </Example>
      <Example label="h2 · text-lg font-semibold">
        <p className="font-semibold text-lg">{t("heading")}</p>
      </Example>
      <Example label="card title · text-base font-medium">
        <p className="font-medium text-base">{t("heading")}</p>
      </Example>
      <Example label="body · text-sm">
        <p className="max-w-prose text-sm">{t("body")}</p>
      </Example>
      <Example label="secondary · text-xs text-muted-foreground">
        <p className="max-w-prose text-muted-foreground text-xs">{t("body")}</p>
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
