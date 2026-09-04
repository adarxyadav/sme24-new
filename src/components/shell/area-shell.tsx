import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SkipLink } from "@/components/skip-link";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { Area } from "@/lib/auth/roles";
import { roleFromClaims } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Shared frame for the three signed in areas (spec 0003): reads the claims and the sidebar cookie
 * on the server, then hands plain data to the client sidebar. The proxy has already checked the
 * role. Server component, `force-dynamic` through the area layouts.
 */
export async function AreaShell({ area, children }: { area: Area; children: React.ReactNode }) {
  const t = await getTranslations();
  const locale = await getLocale();
  const cookieStore = await cookies();
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : "";
  const role = roleFromClaims(claims) ?? "";
  const sidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <SkipLink />
      <AppSidebar area={area} email={email} role={role} locale={locale} />
      <SidebarInset id="main" tabIndex={-1} className="outline-none">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <span className="text-muted-foreground text-sm">{t(`areas.${area}.title`)}</span>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
