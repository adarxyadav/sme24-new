import { LandmarkIcon, MapPinIcon, ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * The three seals the footer carries, in the order a buyer doing due diligence asks about them:
 * where the data sits, which law governs it, and who is accountable for it. Each is a claim this
 * repo can back — the Zurich Supabase instance of spec 0001, the revDSG statement of the privacy
 * page, and the company facts of `SITE` — so a seal states a standard we meet, never a
 * certification we hold. An audit seal we have not earned would be the one mark on the page a
 * buyer could disprove.
 */
const BADGES = [
  { key: "residency", Icon: MapPinIcon, href: "/privacy" },
  { key: "revdsg", Icon: ShieldCheckIcon, href: "/privacy" },
  { key: "swiss", Icon: LandmarkIcon, href: "/imprint" },
] as const;

/**
 * One seal: a token drawn disc rather than a flat colour logo, so it inverts with the theme the
 * way the trust band's objects do. A double ring — the outer hairline and an inset one — is what
 * makes a disc read as a seal rather than as an avatar, and both are drawn from `--foreground`
 * so the mark keeps its weight on either ground.
 */
const SEAL =
  "relative flex size-24 flex-col items-center justify-center gap-1 rounded-full border border-foreground/25 bg-card px-2 text-center transition-colors group-hover:border-foreground/50";

/**
 * The compliance row of the public footer: three round marks above the copyright bar, each a link
 * to the page carrying the detail behind it. The disc is decorative and the full claim lives in
 * the visible caption beside it, so nothing is announced by shape or colour alone. Every label is
 * sentence case per the deliberate exception in `docs/design.md`. Server component; adds no
 * client JavaScript to the page.
 */
export function ComplianceBadges() {
  const t = useTranslations("marketing.footer.compliance");

  return (
    <ul aria-label={t("label")} className="flex flex-wrap items-start gap-x-8 gap-y-6">
      {BADGES.map(({ key, Icon, href }) => (
        <li key={key}>
          <Link href={href} className="group block" title={t(`items.${key}.detail`)}>
            <span className={SEAL}>
              {/* The inset ring, which is what separates a seal from a plain round avatar. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-1.5 rounded-full border border-foreground/15"
              />
              <Icon aria-hidden="true" className="size-4 shrink-0 text-foreground" />
              {/*
                  The claim itself, not a label repeating the caption beside it: the seal is
                  self-contained the way a certification mark is, so the row reads as three marks
                  rather than three icons with prose stuck to them.
                */}
              <span className="text-pretty font-semibold text-[0.5625rem] text-foreground uppercase tracking-caps leading-[1.35]">
                {t(`items.${key}.seal`)}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
