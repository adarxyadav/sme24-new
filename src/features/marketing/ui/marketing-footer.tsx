import { MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Signature } from "@/components/brand/signature";
import { ThemeToggle } from "@/components/theme-toggle";
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

const LINK_CLASS =
  "text-muted-foreground text-sm underline-offset-4 transition-colors hover:text-foreground hover:underline";

/**
 * The public site footer (spec 0009, AC-7): the signature, the one line site description and
 * the mail address on the left, the Product, Company and (once feature 14 fills it) Legal link
 * groups on the right, then a bottom bar with the copyright line and the theme control. The
 * language switch stays in the header only, so the page has a single language control (a
 * dropdown button and its menu, not a landmark). Every route link is a typed `Link`.
 * Server component; the copyright year is the build year, static pages rebuild on deploy.
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
      ],
    },
    ...(legal.length > 0
      ? [{ key: "legal", title: t("marketing.footer.legal"), links: legal }]
      : []),
  ];

  return (
    <footer className="border-t">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="grid gap-10 py-12 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16 md:py-16">
          <div className="flex max-w-sm flex-col gap-4">
            <Signature className="font-medium text-lg" />
            <p className="text-muted-foreground text-sm">{t("metadata.description")}</p>
            <a
              href={`mailto:${SITE.email}`}
              className="inline-flex w-fit items-center gap-2 text-muted-foreground text-sm underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              <MailIcon aria-hidden="true" className="size-4" />
              {SITE.email}
            </a>
          </div>

          <div className="flex flex-wrap gap-x-10 gap-y-8 lg:gap-x-16">
            {groups.map((group) => (
              <nav
                key={group.key}
                aria-labelledby={`footer-${group.key}`}
                className="flex min-w-32 flex-col gap-3.5"
              >
                <h2 id={`footer-${group.key}`} className="eyebrow">
                  {group.title}
                </h2>
                <ul className="flex flex-col gap-2.5">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      {link.kind === "route" ? (
                        <Link href={link.href} className={LINK_CLASS}>
                          {link.label}
                        </Link>
                      ) : (
                        <a href={link.href} className={LINK_CLASS}>
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground text-xs">
            {t("marketing.footer.copyright", {
              year: String(new Date().getFullYear()),
              name: SITE.legalName,
            })}
          </p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
