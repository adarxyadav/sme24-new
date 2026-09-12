"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  type UpdateAssessmentDetailsResult,
  updateAssessmentDetails,
} from "@/features/assessments/actions";
import { useFormAction } from "@/hooks/use-form-action";

export type DetailsFormProps = {
  readonly assessmentId: string;
  readonly site: string | null;
  /** `YYYY-MM-DD`, the shape `conducted_on` stores and a `date` input carries. */
  readonly conductedOn: string | null;
};

/**
 * The site and the visit date of a draft (spec 0019, AC-6): the two columns the grant allows
 * besides the status, pre filled from the booking when there was one. Saves on the button, not on
 * every keystroke, because a site name is typed once; the success toast hangs off the click.
 * Browser.
 */
export function DetailsForm({ assessmentId, site, conductedOn }: DetailsFormProps) {
  const t = useTranslations("assessments.details");
  const router = useRouter();
  const [siteValue, setSiteValue] = useState(site ?? "");
  const [dateValue, setDateValue] = useState(conductedOn ?? "");
  const update = useFormAction<
    UpdateAssessmentDetailsResult,
    { assessmentId: string; site: string; conductedOn: string | null }
  >(updateAssessmentDetails);

  const dirty = siteValue !== (site ?? "") || dateValue !== (conductedOn ?? "");

  async function save() {
    const outcome = await update.submit({
      assessmentId,
      site: siteValue,
      conductedOn: dateValue === "" ? null : dateValue,
    });
    if (!outcome.ok) {
      toast.error(t(`errors.${outcome.error}`));
      return;
    }
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault();
        if (dirty && !update.pending) void save();
      }}
      data-assessment-details
    >
      <Field className="sm:max-w-xs sm:flex-1">
        <FieldLabel htmlFor={`site-${assessmentId}`}>{t("site")}</FieldLabel>
        <Input
          id={`site-${assessmentId}`}
          value={siteValue}
          maxLength={200}
          placeholder={t("sitePlaceholder")}
          onChange={(event) => setSiteValue(event.target.value)}
        />
      </Field>
      <Field className="sm:w-44">
        <FieldLabel htmlFor={`conducted-on-${assessmentId}`}>{t("conductedOn")}</FieldLabel>
        <Input
          id={`conducted-on-${assessmentId}`}
          type="date"
          value={dateValue}
          onChange={(event) => setDateValue(event.target.value)}
        />
      </Field>
      <Button type="submit" variant="outline" disabled={!dirty || update.pending}>
        {update.pending ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
