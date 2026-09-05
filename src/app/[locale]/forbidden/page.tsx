import { ShieldOffIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { SkipLink } from "@/components/skip-link";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

export default async function ForbiddenPage({ params }: PageProps<"/[locale]/forbidden">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const t = await getTranslations("forbidden");

  return (
    <>
      <SkipLink />
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-24 outline-none sm:px-6"
      >
        <EmptyState
          icon={ShieldOffIcon}
          titleAs="h1"
          title={t("title")}
          description={t("body")}
          action={
            <Button asChild variant="outline">
              <Link href="/">{t("back")}</Link>
            </Button>
          }
        />
      </main>
    </>
  );
}
