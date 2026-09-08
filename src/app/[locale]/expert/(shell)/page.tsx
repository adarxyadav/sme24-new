import { BriefcaseIcon, MapPinIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PageStack } from "@/components/page-stack";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { listMyAssignments } from "@/features/experts/queries";
import { Link } from "@/i18n/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * The expert's home (spec 0013, AC-11): the client organizations ops have assigned to them, newest
 * first, each linking to the read only page of that client's facts and figures. RLS is what limits
 * the list to their own assignments, so an expert never sees another expert's clients.
 */
export default async function ExpertPage() {
  const [t, catalogue, areas, format, supabase] = await Promise.all([
    getTranslations("experts.assignments"),
    getTranslations("experts.catalogue"),
    getTranslations("areas.expert"),
    getFormatter(),
    createServerSupabaseClient(),
  ]);
  const assignments = await listMyAssignments(supabase);

  return (
    <PageStack>
      <PageHeader title={areas("title")} description={t("lead")} />
      {assignments.length === 0 ? (
        <EmptyState
          icon={BriefcaseIcon}
          title={areas("empty.title")}
          description={areas("empty.description")}
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2" data-expert-assignments>
          {assignments.map((assignment) => (
            <li key={assignment.assignmentId}>
              <Card className="relative h-full transition-colors hover:border-primary/50">
                <CardContent className="flex h-full flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h2 className="font-semibold text-base">
                      <Link
                        href={{
                          pathname: "/expert/clients/[organizationId]",
                          params: { organizationId: assignment.organizationId },
                        }}
                        // The whole card is the link target; the heading carries it so the
                        // accessible name of the link is the client's name and nothing else.
                        className="after:absolute after:inset-0 hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                      >
                        {assignment.companyName ?? assignment.organizationName}
                      </Link>
                    </h2>
                    {assignment.companyName &&
                    assignment.companyName !== assignment.organizationName ? (
                      <p className="text-muted-foreground text-sm">{assignment.organizationName}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {assignment.canton ? (
                      <Badge variant="outline" className="gap-1">
                        <MapPinIcon className="size-3" aria-hidden="true" />
                        {assignment.canton}
                      </Badge>
                    ) : null}
                    {assignment.industrySection ? (
                      <Badge variant="secondary">
                        {catalogue(`industries.${assignment.industrySection as "A"}`)}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-auto text-muted-foreground text-xs">
                    {t("since", {
                      date: format.dateTime(new Date(assignment.startedAt), "dateShort"),
                    })}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageStack>
  );
}
