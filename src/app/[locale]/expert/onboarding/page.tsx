import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { AuthPage } from "@/features/auth/ui/auth-page";
import { requireOnboardingExpert } from "@/features/experts/gate";
import { getMyExpertProfile } from "@/features/experts/queries";
import { ExpertOnboardingForm } from "@/features/experts/ui/onboarding-form";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

// Spec 0001: authenticated areas are never served from a shared cache.
export const dynamic = "force-dynamic";

/**
 * The one expert page outside the area shell (spec 0013, AC-4): consent plus the few fields that
 * make an expert assignable at all. It renders in the auth frame, like the client's own onboarding
 * page, because an expert who has not consented yet has no business seeing the area's navigation.
 * The gate sends an expert who has already finished back to `/expert`.
 */
export default async function ExpertOnboardingPage() {
  await requireOnboardingExpert();

  const [t, supabase, messages] = await Promise.all([
    getTranslations("experts.onboarding"),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const [profile, { data: user }] = await Promise.all([
    getMyExpertProfile(supabase),
    supabase.auth.getUser(),
  ]);
  const fullName = user.user?.user_metadata?.full_name;

  return (
    <AuthPage title={t("title")} description={t("lead")}>
      <NextIntlClientProvider messages={clientMessages(messages, ["experts"])}>
        <ExpertOnboardingForm
          fullName={typeof fullName === "string" ? fullName : ""}
          headline={profile?.headline ?? ""}
        />
      </NextIntlClientProvider>
    </AuthPage>
  );
}
