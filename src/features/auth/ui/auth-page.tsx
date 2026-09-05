import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SkipLink } from "@/components/skip-link";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { clientMessages } from "@/i18n/client-messages";
import { Link } from "@/i18n/navigation";

export type AuthPageProps = {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
};

/**
 * The frame of every auth page (spec 0005): brand header with language and theme, one centred
 * card with the page's `h1`, and the `auth` messages handed to the client forms through a nested
 * provider. Server component.
 */
export async function AuthPage({ title, description, children, footer }: AuthPageProps) {
  const messages = clientMessages(await getMessages(), ["auth"]);

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
              <CardTitle className="text-2xl tracking-headline">
                <h1>{title}</h1>
              </CardTitle>
              {description ? <CardDescription>{description}</CardDescription> : null}
            </CardHeader>
            <NextIntlClientProvider messages={messages}>
              <CardContent className="flex flex-col gap-6">{children}</CardContent>
              {footer ? (
                <CardFooter className="mt-6 flex-col items-stretch gap-3 text-sm">
                  {footer}
                </CardFooter>
              ) : null}
            </NextIntlClientProvider>
          </Card>
        </main>
      </div>
    </>
  );
}
