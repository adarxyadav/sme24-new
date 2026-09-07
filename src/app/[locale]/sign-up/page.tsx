import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { SignUpForm } from "@/features/auth/ui/sign-up-form";
import { Link } from "@/i18n/navigation";
import { resolveLocale } from "@/i18n/routing";
import { nextWithinLocale } from "@/lib/auth/redirects";

/** The landing page's lookup field hands the company name over as `?company=` (spec 0009, AC-5). */
const COMPANY_MAX = 200;

/**
 * Public client sign up (spec 0005, AC-1, AC-2); the proxy sends a signed in user to their area.
 * Reads the `company` entry of the query (trimmed, cut at 200 characters, ignored when empty)
 * and prefills the organization name with it, which makes the page dynamic (the proxy already
 * forces that for the auth pages). A `next` entry carries the visitor on after signing up, which
 * is how a pricing page button lands them back on the checkout for the package they picked
 * (spec 0011, AC-16); it is validated against the locale, so it can only ever point inside the app.
 */
export default async function SignUpPage({ params, searchParams }: PageProps<"/[locale]/sign-up">) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  setRequestLocale(resolveLocale(locale));
  const t = await getTranslations("auth.signUp");
  const company = Array.isArray(query.company) ? query.company[0] : query.company;
  const defaultCompany = (company ?? "").trim().slice(0, COMPANY_MAX);
  const rawNext = Array.isArray(query.next) ? query.next[0] : query.next;
  const next = nextWithinLocale(rawNext, resolveLocale(locale)) ?? undefined;

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
      <SignUpForm defaultCompany={defaultCompany} next={next} />
    </AuthPage>
  );
}
