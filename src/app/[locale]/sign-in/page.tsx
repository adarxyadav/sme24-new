import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SkipLink } from "@/components/skip-link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signIn } from "@/features/auth/actions";
import { Link } from "@/i18n/navigation";

export default async function SignInPage({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  const query = await searchParams;
  const t = await getTranslations();
  const invalid = query.error === "invalid";
  const next = typeof query.next === "string" ? query.next : "";

  return (
    <>
      <SkipLink />
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 items-center justify-between px-4 sm:px-6">
          <Link href="/" className="rounded-md">
            <Logo size="md" />
          </Link>
          <div className="flex items-center gap-2">
            <LocaleSwitcher />
            <ThemeToggle />
          </div>
        </header>
        <main
          id="main"
          tabIndex={-1}
          className="flex flex-1 items-center justify-center px-4 py-12 outline-none sm:px-6"
        >
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle className="text-2xl tracking-headline">{t("auth.signIn.title")}</CardTitle>
              <CardDescription>{t("auth.signIn.lead")}</CardDescription>
            </CardHeader>
            <form action={signIn}>
              <CardContent className="flex flex-col gap-6">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="next" value={next} />
                {invalid ? (
                  <Alert variant="destructive">
                    <AlertTitle>{t("auth.errors.invalidCredentials")}</AlertTitle>
                  </Alert>
                ) : null}
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="email">{t("auth.signIn.email")}</FieldLabel>
                    <Input id="email" name="email" type="email" autoComplete="email" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">{t("auth.signIn.password")}</FieldLabel>
                    <Input
                      id="password"
                      name="password"
                      type="password"
                      autoComplete="current-password"
                      required
                      minLength={6}
                    />
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="mt-6">
                <Button type="submit" className="w-full" size="lg">
                  {t("auth.signIn.submit")}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </main>
      </div>
    </>
  );
}
