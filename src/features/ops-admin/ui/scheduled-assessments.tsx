import { CalendarCheckIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { AssignedExpertSummary } from "@/features/experts/queries";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";
import type { ScheduledAssessment } from "../queries";

export type ScheduledAssessmentsProps = {
  readonly assessments: readonly ScheduledAssessment[];
  /** The organization's assigned experts, from `listAssignedExperts`; matched by `expertId`. */
  readonly experts: readonly AssignedExpertSummary[];
};

/**
 * The client's "Your assessment" card (spec 0014, AC-10): each booked order with its own date and
 * the assessor going, so an organization holding several bookings sees the right expert on each.
 *
 * The expert is matched by the order's `assigned_expert_id` against `assigned_expert_summaries`,
 * never by position and never by taking the organization's first expert: two orders may name two
 * different people. An order whose expert is not in the summaries (the assignment was ended after
 * the visit, say) still shows its date, because the booking is the fact the client needs.
 *
 * The section is absent, not empty, when nothing is booked: an empty state here would tell every
 * client without a booking that they are missing something. Server component.
 */
export async function ScheduledAssessments({ assessments, experts }: ScheduledAssessmentsProps) {
  if (assessments.length === 0) return null;

  const [t, orders, format] = await Promise.all([
    getTranslations("orders.assessment"),
    getTranslations("orders"),
    getFormatter(),
  ]);
  const byExpert = new Map(experts.map((expert) => [expert.expertId, expert]));

  return (
    <section
      aria-labelledby="scheduled-assessments-heading"
      className="flex flex-col gap-4"
      data-scheduled-assessments
    >
      <div className="flex flex-col gap-1">
        <h2 id="scheduled-assessments-heading" className="font-semibold text-lg">
          {t("heading", { count: assessments.length })}
        </h2>
        <p className="max-w-prose text-muted-foreground text-sm">{t("description")}</p>
      </div>
      <ul className="grid gap-4">
        {assessments.map((assessment) => {
          const expert = byExpert.get(assessment.expertId);
          return (
            <li key={assessment.orderId}>
              <Card>
                <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
                  <ExpertAvatar
                    fullName={expert?.fullName ?? null}
                    photoUrl={expert?.photoUrl ?? null}
                    className="size-16 shrink-0"
                  />
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-base">{assessment.packageName}</span>
                      <Badge variant={assessment.status === "delivered" ? "success" : "info"}>
                        {orders(`status.${assessment.status as "scheduled"}`)}
                      </Badge>
                    </div>
                    <p className="flex items-center gap-2 text-sm">
                      <CalendarCheckIcon className="size-4 shrink-0" aria-hidden="true" />
                      <time dateTime={assessment.scheduledAt}>
                        {format.dateTime(new Date(assessment.scheduledAt), "dateTime")}
                      </time>
                    </p>
                    <p className="text-muted-foreground text-sm">
                      {expert
                        ? t("with", { name: expert.fullName ?? t("unnamed") })
                        : t("expertPending")}
                    </p>
                    {expert?.headline ? (
                      <p className="text-muted-foreground text-sm">{expert.headline}</p>
                    ) : null}
                    <p className="font-mono text-muted-foreground text-xs">
                      {assessment.reference}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
