import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { VerifyCodeForm } from "@/features/auth/ui/verify-code-form";
import { resolveLocale } from "@/i18n/routing";

/** Enter the emailed six digit code (spec 0005, AC-2, AC-4); `email` and `next` come from the requesting page. */
export default async function VerifyCodePage({
  params,
  searchParams,
}: PageProps<"/[locale]/verify-code">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const query = await searchParams;
  const t = await getTranslations("auth.verifyCode");
  const email = typeof query.email === "string" ? query.email : "";
  const next = typeof query.next === "string" ? query.next : undefined;

  return (
    <AuthPage title={t("title")} description={t("lead")}>
      <VerifyCodeForm email={email} next={next} />
    </AuthPage>
  );
}
