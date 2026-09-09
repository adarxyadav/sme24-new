import { getTranslations, setRequestLocale } from "next-intl/server";
import { MarketingHeader } from "@/components/marketing-header";
import { SkipLink } from "@/components/skip-link";
import { organizationJsonLd } from "@/features/marketing/json-ld";
import { SITE } from "@/features/marketing/site";
import { JsonLd } from "@/features/marketing/ui/json-ld";
import { MarketingFooter } from "@/features/marketing/ui/marketing-footer";
import { resolveLocale } from "@/i18n/routing";
import { clientEnv } from "@/lib/env";

/**
 * Public pages (spec 0009): statically rendered (`setRequestLocale` in every layout and page on
 * this path), the header with the three site links, the footer with the link groups (its legal
 * group filled by spec 0015, AC-9) and the `Organization` structured data on every page.
 */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const [t, common, legal] = await Promise.all([
    getTranslations("marketing.nav"),
    getTranslations("common"),
    getTranslations("legalPages"),
  ]);
  const appUrl = clientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  // `data-marketing` scopes the sticky header's `scroll-margin-top` in `globals.css` to these
  // pages; the signed in areas have no sticky bar and must not inherit it.
  return (
    <div data-marketing>
      <JsonLd
        data={organizationJsonLd({
          name: common("appName"),
          url: appUrl,
          logo: `${appUrl}/icon.svg`,
          email: SITE.email,
          sameAs: SITE.sameAs,
        })}
      />
      <SkipLink />
      <MarketingHeader
        links={[
          { href: "/how-it-works", label: t("howItWorks") },
          { href: "/expert-network", label: t("expertNetwork") },
          { href: "/pricing", label: t("pricing") },
        ]}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <MarketingFooter
        legal={[
          { kind: "route", href: "/privacy", label: legal("privacy.meta.title") },
          { kind: "route", href: "/terms", label: legal("terms.meta.title") },
          { kind: "route", href: "/imprint", label: legal("imprint.meta.title") },
          { kind: "route", href: "/cookies", label: legal("cookiesPage.meta.title") },
        ]}
      />
    </div>
  );
}
