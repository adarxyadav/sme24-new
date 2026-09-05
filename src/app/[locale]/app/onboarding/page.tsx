import { getTranslations } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { OnboardingForm } from "@/features/auth/ui/onboarding-form";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Spec 0001: authenticated areas are never served from a shared cache.
export const dynamic = "force-dynamic";

/**
 * The one client page without an organization (spec 0005, AC-5, AC-8): the proxy admits only a
 * client whose token has no organization claim. The company name is prefilled from the sign up
 * metadata when a confirmed sign up could not create the organization.
 */
export default async function OnboardingPage() {
  const t = await getTranslations("auth.onboarding");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pending = user?.user_metadata?.organization_name;
  const organizationName = typeof pending === "string" ? pending : "";

  return (
    <AuthPage title={t("title")} description={t("lead")}>
      <OnboardingForm organizationName={organizationName} />
    </AuthPage>
  );
}
