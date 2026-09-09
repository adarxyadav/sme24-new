import { LandmarkIcon, MapPinIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * The three marks the footer carries, in the order a buyer doing due diligence asks about them:
 * where the data sits, which law governs it, and who is accountable for it. Each is a claim this
 * repo can back — the Zurich Supabase instance of spec 0001, the revDSG statement of the privacy
 * page, and the company facts of `SITE` — so the row states standards we meet, never a
 * certification we hold. A seal we have not been audited for would be the one badge on the page a
 * buyer could disprove.
 */
const BADGES = [
  { key: "residency", Icon: MapPinIcon, href: "/privacy" },
  { key: "revdsg", Icon: ShieldCheckIcon, href: "/privacy" },
  { key: "swiss", Icon: LandmarkIcon, href: "/imprint" },
] as const;

/**
 * The compliance row of the public footer: three hairline marks above the copyright bar, each a
 * link to the page carrying the detail behind it. Every label is sentence case per the deliberate
 * exception in `docs/design.md`, and the icons are decorative, so the meaning is carried by the
 * text alone. Server component; adds no client JavaScript to the page.
 */
export function ComplianceBadges() {
  const t = useTranslations("marketing.footer.compliance");

  return (
    <ul aria-label={t("label")} className="flex flex-wrap gap-2.5">
      {BADGES.map(({ key, Icon, href }) => (
        <li key={key}>
          <Link
            href={href}
            className="flex items-center gap-2 border px-3 py-2 text-muted-foreground text-xs transition-colors hover:border-foreground/30 hover:text-foreground"
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0" />
            {/*
                The gap between the two labels is drawn by `flex`, which a screen reader does not
                announce, and a separator element's own whitespace is collapsed away by the name
                computation. So the pause is spelled into the title's own text, hidden from sight,
                leaving the announced name "Swiss hosting: Zurich region" rather than one word.
              */}
            <span className="font-medium text-foreground">
              {t(`items.${key}.title`)}
              <span className="sr-only">:</span>
            </span>
            <span>{t(`items.${key}.detail`)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
