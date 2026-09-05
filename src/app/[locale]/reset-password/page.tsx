import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { ResetPasswordForm } from "@/features/auth/ui/reset-password-form";
import { resolveLocale } from "@/i18n/routing";

// The recovery or invite session is read by the action, never cached (spec 0001).
export const dynamic = "force-dynamic";

/** Set a new password after a recovery or invite link (spec 0005, AC-6, AC-10). */
export default async function ResetPasswordPage({ params }: PageProps<"/[locale]/reset-password">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const t = await getTranslations("auth.resetPassword");

  return (
    <AuthPage title={t("title")} description={t("lead")}>
      <ResetPasswordForm />
    </AuthPage>
  );
}
