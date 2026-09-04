import { getTranslations, setRequestLocale } from "next-intl/server";
import { Signature } from "@/components/brand/signature";
import { MarketingHeader } from "@/components/marketing-header";
import { SkipLink } from "@/components/skip-link";

/** Public pages: statically rendered (setRequestLocale in every layout and page on this path). */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("brand");

  // Navigation links arrive with feature 13 (marketing site); the header already collapses them.
  return (
    <>
      <SkipLink />
      <MarketingHeader links={[]} />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-10 sm:px-6">
          <Signature />
          <p className="eyebrow text-muted-foreground">
            {t("tagline")} · {t("domain")}
          </p>
        </div>
      </footer>
    </>
  );
}
