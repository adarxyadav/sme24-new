import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { ForgotPasswordForm } from "@/features/auth/ui/forgot-password-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Request a password reset link (spec 0005, AC-6). */
export default async function ForgotPasswordPage({
  params,
}: PageProps<"/[locale]/forgot-password">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const t = await getTranslations("auth.forgotPassword");

  return (
    <AuthPage
      title={t("title")}
      description={t("lead")}
      footer={
        <Link href="/sign-in" className="text-foreground underline">
          {t("backToSignIn")}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthPage>
  );
}
