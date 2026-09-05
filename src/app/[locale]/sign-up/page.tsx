import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { SignUpForm } from "@/features/auth/ui/sign-up-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** Public client sign up (spec 0005, AC-1, AC-2); the proxy sends a signed in user to their area. */
export default async function SignUpPage({ params }: PageProps<"/[locale]/sign-up">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const t = await getTranslations("auth.signUp");

  return (
    <AuthPage
      title={t("title")}
      description={t("lead")}
      footer={
        <p className="text-muted-foreground">
          {t("hasAccount")}{" "}
          <Link href="/sign-in" className="text-foreground underline">
            {t("signIn")}
          </Link>
        </p>
      }
    >
      <SignUpForm />
    </AuthPage>
  );
}
