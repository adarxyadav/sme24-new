"use client";

import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  type AssignExpertResult,
  assignExpert,
  type EndAssignmentResult,
  endAssignment,
} from "@/features/experts/actions";
import type { ExpertAssignmentRow, OrganizationOption } from "@/features/experts/queries";
import { useFormAction } from "@/hooks/use-form-action";

export type AssignmentsSectionProps = {
  readonly expertId: string;
  /** Every assignment of this expert, active first, from `getExpertAdminPage`. */
  readonly assignments: readonly ExpertAssignmentRow[];
  /** The organizations ops may pick from, already limited to 20 by the query. */
  readonly organizations: readonly OrganizationOption[];
  /** Only an `active` expert can be assigned; the trigger refuses the rest. */
  readonly assignable: boolean;
};

/**
 * The ops assignment controls on an expert's admin page (spec 0013, AC-9): a searchable picker
 * that assigns this expert to a client organization, and the list of assignments with an "End"
 * button on each active one.
 *
 * The picker is not filtered to unassigned organizations here: the active unique index is what
 * decides, and the action answers `already_assigned` for a duplicate, so two ops assigning at
 * once get the same answer as one ops clicking twice. Browser.
 */
export function AssignmentsSection({
  expertId,
  assignments,
  organizations,
  assignable,
}: AssignmentsSectionProps) {
  const t = useTranslations("experts.assign");
  const format = useFormatter();
  const router = useRouter();
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  const assign = useFormAction<AssignExpertResult, { expertId: string; organizationId: string }>(
    assignExpert,
  );
  const end = useFormAction<EndAssignmentResult, { assignmentId: string }>(endAssignment);

  useEffect(() => {
    if (assign.result?.ok) {
      toast.success(t("assigned"));
      setOrganizationId(null);
      router.refresh();
    }
  }, [assign.result, router, t]);

  useEffect(() => {
    if (end.result?.ok) {
      toast.success(t("ended"));
      router.refresh();
    }
  }, [end.result, router, t]);

  const failure = assign.result?.ok === false ? assign.result.error : null;
  const endFailure = end.result?.ok === false ? end.result.error : null;

  return (
    <div className="flex flex-col gap-6" data-expert-assignments>
      {failure ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${failure}`)}</AlertTitle>
        </Alert>
      ) : null}
      {endFailure ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`endErrors.${endFailure}`)}</AlertTitle>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field className="sm:max-w-sm">
          <FieldLabel htmlFor="assign-organization">{t("organization")}</FieldLabel>
          <Combobox
            id="assign-organization"
            options={organizations.map((organization) => ({
              value: organization.id,
              label: organization.name,
              description: organization.companyName,
            }))}
            value={organizationId}
            onValueChange={setOrganizationId}
            placeholder={t("placeholder")}
            searchPlaceholder={t("search")}
            emptyLabel={t("noMatches")}
            disabled={!assignable || assign.pending}
          />
        </Field>
        <Button
          type="button"
          disabled={!assignable || !organizationId || assign.pending}
          onClick={() => organizationId && assign.submit({ expertId, organizationId })}
        >
          {assign.pending ? t("assigning") : t("submit")}
        </Button>
      </div>
      {assignable ? null : <p className="text-muted-foreground text-sm">{t("notAssignable")}</p>}

      {assignments.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("none")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-lg border">
          {assignments.map((assignment) => (
            <li
              key={assignment.id}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="font-medium text-sm">{assignment.organizationName}</span>
                <span className="text-muted-foreground text-xs">
                  {assignment.status === "active"
                    ? t("since", {
                        date: format.dateTime(new Date(assignment.started_at), "dateShort"),
                      })
                    : t("endedOn", {
                        date: assignment.ended_at
                          ? format.dateTime(new Date(assignment.ended_at), "dateShort")
                          : "—",
                      })}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={assignment.status === "active" ? "success" : "secondary"}>
                  {t(`status.${assignment.status === "active" ? "active" : "ended"}`)}
                </Badge>
                {assignment.status === "active" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={end.pending}
                    onClick={() => end.submit({ assignmentId: assignment.id })}
                  >
                    {t("end")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
