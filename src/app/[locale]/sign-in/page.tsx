import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { signIn } from "@/features/auth/actions";

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  const query = await searchParams;
  const t = await getTranslations("signIn");
  const invalid = query.error === "invalid";
  const next = typeof query.next === "string" ? query.next : "";

  return (
    <main id="main" className="mx-auto flex max-w-sm flex-col gap-6 px-6 py-24">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <LocaleSwitcher />
      </div>
      <form action={signIn} className="flex flex-col gap-4">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm font-medium">
            {t("email")}
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="rounded-md border bg-background px-3 py-2"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            {t("password")}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            className="rounded-md border bg-background px-3 py-2"
          />
        </div>
        {invalid ? (
          <p role="alert" className="text-sm text-destructive">
            {t("invalid")}
          </p>
        ) : null}
        <Button type="submit">{t("submit")}</Button>
      </form>
    </main>
  );
}
