import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { AppSidebar } from "@/components/shell/app-sidebar";
import { SkipLink } from "@/components/skip-link";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readTermsStale } from "@/features/legal/queries";
import { TermsGate } from "@/features/legal/ui/terms-gate";
import { clientMessages } from "@/i18n/client-messages";
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
  // Spec 0015 (AC-10): the terms gate lives here rather than per page, so a page added later
  // inherits it. It is a render concern only; the column grant is the real boundary.
  const termsStale = await readTermsStale();
  // The sidebar names the area from `areas`, a feature namespace outside the shared client bundle.
  const messages = clientMessages(await getMessages(), ["areas"]);

  // Both providers moved out of the root layout so their weight leaves the static marketing
  // pages (spec 0009, Follow-up); every `toast()` and `Tooltip` in the app renders inside here.
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <SkipLink />
        <NextIntlClientProvider messages={messages}>
          <AppSidebar area={area} email={email} role={role} locale={locale} />
        </NextIntlClientProvider>
        <SidebarInset id="main" tabIndex={-1} className="outline-none">
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
            <span className="text-muted-foreground text-sm">{t(`areas.${area}.title`)}</span>
          </header>
          {children}
        </SidebarInset>
        {termsStale && (
          <NextIntlClientProvider messages={messages}>
            <TermsGate locale={locale} />
          </NextIntlClientProvider>
        )}
        <Toaster />
      </SidebarProvider>
    </TooltipProvider>
  );
}
