import { getTranslations, setRequestLocale } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Link } from "@/i18n/navigation";

/** Public pages: statically rendered (setRequestLocale in every layout and page on this path). */
export default async function MarketingLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold">
            {t("appName")}
          </Link>
          <div className="flex items-center gap-4">
            <LocaleSwitcher />
            <Link href="/sign-in" className="text-sm underline-offset-4 hover:underline">
              {t("signIn")}
            </Link>
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
