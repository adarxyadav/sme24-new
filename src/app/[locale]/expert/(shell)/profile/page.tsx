import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { profileFormDefaults } from "@/features/experts/form";
import { getMyExpertProfile, photoUrl } from "@/features/experts/queries";
import { todayInZurich } from "@/features/experts/schema";
import { ExpertPhotoField } from "@/features/experts/ui/photo-field";
import { ExpertProfileForm } from "@/features/experts/ui/profile-form";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function generateMetadata() {
  const t = await getTranslations("experts.profile");
  return { title: t("title") };
}

/**
 * The expert's own profile (spec 0013, AC-5, AC-6): the photo and the full set of fields ops and
 * clients see. The same form component ops open on the admin page, with no `expertId`, so the
 * action writes the caller's own row under their own RLS policy.
 *
 * `notFound()` rather than an empty state when the row is missing: the gate on the layout already
 * lets an expert without a profile through to the area, and this page has nothing to show them.
 * Server component, expert only.
 */
export default async function ExpertProfilePage() {
  const [t, supabase, messages] = await Promise.all([
    getTranslations("experts.profile"),
    createServerSupabaseClient(),
    getMessages(),
  ]);
  const profile = await getMyExpertProfile(supabase);
  if (!profile) notFound();

  const [signedPhotoUrl, { data }] = await Promise.all([
    photoUrl(supabase, profile.photo_path),
    supabase.from("profiles").select("full_name").eq("id", profile.expert_id).maybeSingle(),
  ]);

  return (
    <PageStack>
      <PageHeader title={t("title")} description={t("lead")} />
      <NextIntlClientProvider messages={clientMessages(messages, ["experts"])}>
        <Card>
          <CardHeader>
            <CardTitle>{t("photoHeading")}</CardTitle>
            <CardDescription>{t("photoDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpertPhotoField
              fullName={data?.full_name ?? null}
              photoUrl={signedPhotoUrl}
              hasPhoto={Boolean(profile.photo_path)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t("heading")}</CardTitle>
            <CardDescription>{t("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpertProfileForm defaults={profileFormDefaults(profile)} today={todayInZurich()} />
          </CardContent>
        </Card>
      </NextIntlClientProvider>
    </PageStack>
  );
}
