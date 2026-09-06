import { useTranslations } from "next-intl";
import { Signature } from "@/components/brand/signature";
import { SITE } from "@/features/marketing/site";
import { Link } from "@/i18n/navigation";
import type { StaticPathname } from "@/i18n/pathnames";

export type FooterLink =
  | { readonly kind: "route"; readonly href: StaticPathname; readonly label: string }
  | { readonly kind: "external"; readonly href: string; readonly label: string };

export type MarketingFooterProps = {
  /** The legal group feature 14 fills (privacy, terms, imprint); not rendered while empty. */
  readonly legal?: readonly FooterLink[];
};

/**
 * The public site footer (spec 0009, AC-7): the signature and the tagline, then the Product,
 * Company and (once feature 14 fills it) Legal link groups. Every route link is a typed `Link`.
 * Server component.
 */
export function MarketingFooter({ legal = [] }: MarketingFooterProps) {
  const t = useTranslations();
  const groups: ReadonlyArray<{
    readonly key: string;
    readonly title: string;
    readonly links: readonly FooterLink[];
  }> = [
    {
      key: "product",
      title: t("marketing.footer.product"),
      links: [
        { kind: "route", href: "/pricing", label: t("marketing.nav.pricing") },
        { kind: "route", href: "/sign-up", label: t("marketing.nav.freeBenchmark") },
      ],
    },
    {
      key: "company",
      title: t("marketing.footer.company"),
      links: [
        { kind: "route", href: "/about", label: t("marketing.nav.about") },
        { kind: "route", href: "/contact", label: t("marketing.nav.contact") },
        { kind: "external", href: `mailto:${SITE.email}`, label: SITE.email },
      ],
    },
    ...(legal.length > 0
      ? [{ key: "legal", title: t("marketing.footer.legal"), links: legal }]
      : []),
  ];

  return (
    <footer className="border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 sm:px-6">
        <div className="grid gap-8 sm:grid-cols-3">
          {groups.map((group) => (
            <nav
              key={group.key}
              aria-labelledby={`footer-${group.key}`}
              className="flex flex-col gap-3"
            >
              <h2 id={`footer-${group.key}`} className="eyebrow text-muted-foreground">
                {group.title}
              </h2>
              <ul className="flex flex-col gap-2 text-sm">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.kind === "route" ? (
                      <Link href={link.href} className="underline-offset-4 hover:underline">
                        {link.label}
                      </Link>
                    ) : (
                      <a href={link.href} className="underline-offset-4 hover:underline">
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-6 border-t pt-8">
          <Signature />
          <p className="eyebrow text-muted-foreground">
            {t("brand.tagline")} · {t("brand.domain")}
          </p>
        </div>
      </div>
    </footer>
  );
}
