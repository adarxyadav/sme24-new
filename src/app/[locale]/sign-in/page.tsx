import { getTranslations, setRequestLocale } from "next-intl/server";
import type { AuthErrorKey } from "@/features/auth/errors";
import { isLinkExpiredType, type SignInNotice } from "@/features/auth/notices";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { SignInForm } from "@/features/auth/ui/sign-in-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";

/** The `error` query values the handlers and actions redirect with, and the message each shows. */
const QUERY_ERRORS: Readonly<Record<string, AuthErrorKey>> = {
  email_unverified: "emailUnverified",
  provider: "provider",
  session: "sessionMissing",
};

/** Turns the query string into the notice the form shows, or undefined for a plain visit. */
function noticeFrom(
  query: Record<string, string | string[] | undefined>,
): SignInNotice | undefined {
  const error = typeof query.error === "string" ? query.error : undefined;
  if (!error) return undefined;
  if (error === "link_expired") {
    return { kind: "linkExpired", type: isLinkExpiredType(query.type) ? query.type : "signup" };
  }
  const key = QUERY_ERRORS[error];
  return key ? { kind: "error", error: key } : undefined;
}

/** Sign in (spec 0005, AC-3, AC-4, AC-12); the proxy sends a signed in user to their area. */
export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  setRequestLocale(resolveLocale(locale));
  const query = await searchParams;
  const t = await getTranslations("auth.signIn");
  const next = typeof query.next === "string" ? query.next : undefined;

  return (
    <AuthPage
      title={t("title")}
      description={t("lead")}
      footer={
        <p className="text-muted-foreground">
          {t("noAccount")}{" "}
          <Link href="/sign-up" className="text-foreground underline">
            {t("signUp")}
          </Link>
        </p>
      }
    >
      <SignInForm next={next} notice={noticeFrom(query)} />
    </AuthPage>
  );
}
