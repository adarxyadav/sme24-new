import { useTranslations } from "next-intl";
import { BrandMark } from "@/components/brand/brand-mark";
import { Logo } from "@/components/brand/logo";
import { Signature } from "@/components/brand/signature";
import { Statement } from "@/components/brand/statement";
import { Example } from "@/components/gallery/gallery-section";
import { BRAND_COLORS } from "@/lib/design-tokens";

/** The four approved mark variants (brand guidelines, section 02): ground and ink are fixed. */
const VARIANTS = [
  { key: "bareOnWhite", variant: "bare", ground: "bg-pure-white text-jet" },
  { key: "bareOnJet", variant: "bare", ground: "bg-jet text-pure-white" },
  { key: "badgeOnWhite", variant: "badge", ground: "bg-pure-white text-jet" },
  { key: "badgeOnObsidian", variant: "badge", ground: "bg-obsidian text-pure-white" },
] as const;

/**
 * Brand assets and the campaign patterns: mark variants, lockups, palette, the statement with its
 * square stop and the signature, so every brand rule has one place to be checked. Server.
 */
export function BrandSection() {
  const t = useTranslations("gallery.brand");

  return (
    <div className="flex flex-col gap-12">
      <Example label={t("variants")}>
        <ul className="grid w-full grid-cols-2 gap-4 md:grid-cols-4">
          {VARIANTS.map((item) => (
            <li
              key={item.key}
              className={`flex aspect-square flex-col items-center justify-center gap-4 border ${item.ground}`}
            >
              <BrandMark variant={item.variant} className="h-16 w-auto" />
              <span className="eyebrow opacity-70">{t(`variant.${item.key}`)}</span>
            </li>
          ))}
        </ul>
      </Example>

      <Example label={t("lockups")}>
        <div className="flex flex-wrap items-center gap-12">
          <Logo size="lg" descriptor />
          <Logo variant="badge" size="lg" descriptor />
          <Logo size="sm" />
        </div>
      </Example>

      <Example label={t("palette")}>
        <ul className="grid w-full gap-4 sm:grid-cols-3">
          {BRAND_COLORS.map((color) => (
            <li key={color.token} className="flex flex-col gap-3 border p-4">
              <span aria-hidden="true" className={`h-16 border bg-${color.token}`} />
              <span className="font-semibold text-sm">{color.name}</span>
              <code className="font-mono text-muted-foreground text-xs">
                {color.hex} · --color-{color.token}
              </code>
            </li>
          ))}
        </ul>
      </Example>

      <Example label={t("statement")}>
        <Statement text={t("statementText")} className="text-display-sm md:text-display" />
      </Example>

      <Example label={t("inverse")}>
        <div className="dark flex w-full flex-col gap-6 bg-background p-8 text-foreground sm:p-10">
          <p className="eyebrow text-muted-foreground">{t("eyebrowText")}</p>
          <Statement text={t("inverseText")} className="text-display-sm" />
          <p className="max-w-prose text-muted-foreground text-sm">{t("inverseBody")}</p>
        </div>
      </Example>

      <Example label={t("signature")}>
        <Signature />
      </Example>

      <Example label={t("rules")}>
        <ul className="grid max-w-prose list-disc gap-1 pl-5 text-muted-foreground text-sm">
          {(["clearSpace", "minimum", "noRecolor", "noEffects", "noRedraw"] as const).map(
            (rule) => (
              <li key={rule}>{t(`rule.${rule}`)}</li>
            ),
          )}
        </ul>
      </Example>
    </div>
  );
}
