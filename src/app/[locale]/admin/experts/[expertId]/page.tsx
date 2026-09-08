import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getExpertAdminPage, listOrganizationsForAssignment } from "@/features/experts/queries";
import { AssignmentsSection } from "@/features/experts/ui/assignments-section";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
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
 * One expert's admin page (spec 0013, AC-7, AC-9). Milestone 2 builds the summary and the
 * assignment controls, which is what ops need to put an expert in front of a client; the profile
 * form, the ops notes and the offboarding buttons join it in the milestones after.
 */
export default async function AdminExpertPage({ params }: Props) {
  const { expertId } = await params;
  const [t, catalogue, format, supabase, messages] = await Promise.all([
    getTranslations("experts.admin"),
    getTranslations("experts.catalogue"),
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
    </PageStack>
  );
}
