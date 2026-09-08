import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { AssignedExpertSummary } from "@/features/experts/queries";
import { ExpertAvatar } from "./expert-avatar";

export type AssignedExpertsProps = {
  readonly experts: readonly AssignedExpertSummary[];
};

/**
 * The client's "Your expert" card (spec 0013, AC-12): who is walking their site, what they cover
 * and since when. The rows come from `assigned_expert_summaries`, whose where clause is the access
 * boundary, so this component renders whatever it is handed and filters nothing itself.
 *
 * The section is absent, not empty, when there is no assignment: an empty state here would tell
 * every client without an expert that they are missing something. Server component.
 */
export async function AssignedExperts({ experts }: AssignedExpertsProps) {
  if (experts.length === 0) return null;

  const [t, catalogue, format] = await Promise.all([
    getTranslations("experts.assigned"),
    getTranslations("experts.catalogue"),
    getFormatter(),
  ]);

  return (
    <section
      aria-labelledby="assigned-experts-heading"
      className="flex flex-col gap-4"
      data-assigned-experts
    >
      <div className="flex flex-col gap-1">
        <h2 id="assigned-experts-heading" className="font-semibold text-lg">
          {t("heading", { count: experts.length })}
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <ul className="grid gap-4">
        {experts.map((expert) => (
          <li key={expert.assignmentId}>
            <Card>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:gap-6">
                <ExpertAvatar
                  fullName={expert.fullName}
                  photoUrl={expert.photoUrl}
                  className="size-16 shrink-0"
                />
                <div className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="font-semibold text-base">{expert.fullName ?? t("unnamed")}</h3>
                    {expert.headline ? (
                      <p className="text-muted-foreground text-sm">{expert.headline}</p>
                    ) : null}
                  </div>
                  {expert.bio ? <p className="max-w-prose text-sm">{expert.bio}</p> : null}
                  {expert.competencies.length > 0 ||
                  expert.industries.length > 0 ||
                  expert.standards.length > 0 ||
                  expert.languages.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {expert.competencies.map((code) => (
                        <Badge key={`c-${code}`}>
                          {catalogue(`competencies.${code as "compliance"}`)}
                        </Badge>
                      ))}
                      {expert.standards.map((code) => (
                        <Badge key={`s-${code}`} variant="secondary">
                          {catalogue(`standards.${code as "iso_45001"}`)}
                        </Badge>
                      ))}
                      {expert.industries.map((code) => (
                        <Badge key={`i-${code}`} variant="outline">
                          {catalogue(`industries.${code as "A"}`)}
                        </Badge>
                      ))}
                      {expert.languages.map((code) => (
                        <Badge key={`l-${code}`} variant="outline">
                          {catalogue(`languages.${code as "de"}`)}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {expert.startedAt ? (
                    <p className="text-muted-foreground text-xs">
                      {t("since", {
                        date: format.dateTime(new Date(expert.startedAt), "dateShort"),
                      })}
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
