import { setRequestLocale } from "next-intl/server";
import { MarketingHeader } from "@/components/marketing-header";
import { SkipLink } from "@/components/skip-link";

/** Public pages: statically rendered (setRequestLocale in every layout and page on this path). */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Navigation links arrive with feature 13 (marketing site); the header already collapses them.
  return (
    <>
      <SkipLink />
      <MarketingHeader links={[]} />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
    </>
  );
}
