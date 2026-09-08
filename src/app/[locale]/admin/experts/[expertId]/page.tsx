import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExpertStatus } from "@/features/experts/catalogue";
import { profileFormDefaults } from "@/features/experts/form";
import { getExpertAdminPage, listOrganizationsForAssignment } from "@/features/experts/queries";
import { todayInZurich } from "@/features/experts/schema";
import { ExpertAccountActions } from "@/features/experts/ui/account-actions";
import { AssignmentsSection } from "@/features/experts/ui/assignments-section";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import { OpsNotesEditor } from "@/features/experts/ui/ops-notes-editor";
import { ExpertProfileForm } from "@/features/experts/ui/profile-form";
import { clientMessages } from "@/i18n/client-messages";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type Props = {
  readonly params: Promise<{ readonly expertId: string }>;
};

export async function generateMetadata() {
  const t = await getTranslations("experts.admin");
  return { title: t("detailTitle") };
}

/**
 * One expert's admin page (spec 0013, AC-3, AC-5, AC-7, AC-8, AC-9, AC-10): the summary, the same
 * profile form the expert fills in, the record check notes the expert never sees, the assignment
 * controls and the account buttons.
 *
 * The profile form is the expert's own component with an `expertId`, not a second form: the fields
 * and the rules would otherwise drift between the two callers, and the action is the one place
 * that decides whether this caller may write that row. Ops only, through the proxy and RLS.
 */
export default async function AdminExpertPage({ params }: Props) {
  const { expertId } = await params;
  const [t, catalogue, notes, account, format, supabase, messages] = await Promise.all([
    getTranslations("experts.admin"),
    getTranslations("experts.catalogue"),
    getTranslations("experts.notes"),
    getTranslations("experts.account"),
    getFormatter(),
    createServerSupabaseClient(),
    getMessages(),
  ]);

  const page = await getExpertAdminPage(supabase, expertId);
  if (!page) notFound();

  const { profile } = page;
  // Only an `active` expert can be assigned; the database trigger is what enforces it, this only
  // keeps ops from being offered a control whose answer is already known.
  const assignable = profile.status === "active";
  const organizations = assignable ? await listOrganizationsForAssignment(supabase, "") : [];

  return (
    <PageStack>
      <PageHeader
        title={page.fullName ?? t("unnamed")}
        description={profile.headline ?? profile.email}
      />

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:gap-6">
          <ExpertAvatar
            fullName={page.fullName}
            photoUrl={page.photoUrl}
            className="size-16 shrink-0"
          />
          <dl className="grid flex-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t("columns.email")}</dt>
              <dd className="text-sm">{profile.email}</dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t("columns.status")}</dt>
              <dd>
                <Badge
                  variant={
                    profile.status === "active"
                      ? "success"
                      : profile.status === "invited"
                        ? "warning"
                        : "secondary"
                  }
                >
                  {t(`status.${profile.status as "invited"}`)}
                </Badge>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t("columns.invited")}</dt>
              <dd className="text-sm">
                {format.dateTime(new Date(profile.invited_at), "dateShort")}
              </dd>
            </div>
            {profile.competencies.length > 0 ? (
              <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
                <dt className="text-muted-foreground text-sm">{t("columns.competencies")}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {profile.competencies.map((code) => (
                    <Badge key={code}>{catalogue(`competencies.${code as "compliance"}`)}</Badge>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("assignments")}</CardTitle>
          <CardDescription>{t("assignmentsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <NextIntlClientProvider messages={clientMessages(messages, ["experts"])}>
            <AssignmentsSection
              expertId={profile.expert_id}
              assignments={page.assignments}
              organizations={organizations}
              assignable={assignable}
            />
          </NextIntlClientProvider>
        </CardContent>
      </Card>

      <NextIntlClientProvider messages={clientMessages(messages, ["experts"])}>
        <Card>
          <CardHeader>
            <CardTitle>{t("profileHeading")}</CardTitle>
            <CardDescription>{t("profileDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpertProfileForm
              defaults={profileFormDefaults(profile)}
              today={todayInZurich()}
              expertId={profile.expert_id}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{notes("heading")}</CardTitle>
            <CardDescription>{notes("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <OpsNotesEditor expertId={profile.expert_id} notes={page.notes} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{account("heading")}</CardTitle>
            <CardDescription>{account("description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ExpertAccountActions
              expertId={profile.expert_id}
              status={profile.status as ExpertStatus}
            />
          </CardContent>
        </Card>
      </NextIntlClientProvider>
    </PageStack>
  );
}
