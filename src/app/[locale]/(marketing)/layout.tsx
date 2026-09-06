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
 * this path), the header with the three site links, the footer with the link groups and the
 * `Organization` structured data on every page.
 */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const [t, common] = await Promise.all([
    getTranslations("marketing.nav"),
    getTranslations("common"),
  ]);
  const appUrl = clientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  return (
    <>
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
          { href: "/pricing", label: t("pricing") },
          { href: "/about", label: t("about") },
          { href: "/contact", label: t("contact") },
        ]}
      />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <MarketingFooter />
    </>
  );
}
