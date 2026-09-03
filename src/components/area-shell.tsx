import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Button } from "@/components/ui/button";
import { signOut } from "@/features/auth/actions";
import { Link } from "@/i18n/navigation";
import type { Area } from "@/lib/auth/roles";
import { roleFromClaims } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/** Shared frame for the three signed in areas. The proxy has already checked the role. */
export async function AreaShell({ area, children }: { area: Area; children: React.ReactNode }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : "";
  const role = roleFromClaims(claims) ?? "";

  return (
    <>
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link href="/" className="font-semibold">
              {t("common.appName")}
            </Link>
            <span className="text-sm text-muted-foreground">{t(`areas.${area}.title`)}</span>
          </div>
          <div className="flex items-center gap-4">
            <LocaleSwitcher />
            <span className="text-sm text-muted-foreground">
              {t("areas.signedInAs", { email, role })}
            </span>
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="outline" size="sm">
                {t("common.signOut")}
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12">
        {children}
      </main>
    </>
  );
}
