import { getTranslations, setRequestLocale } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function ForbiddenPage({ params }: PageProps<"/[locale]/forbidden">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("forbidden");

  return (
    <main id="main" className="mx-auto flex max-w-2xl flex-col items-start gap-4 px-6 py-24">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="text-muted-foreground">{t("body")}</p>
      <Button asChild variant="outline">
        <Link href="/">{t("back")}</Link>
      </Button>
    </main>
  );
}
