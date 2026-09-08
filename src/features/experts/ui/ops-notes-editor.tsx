"use client";

import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { type OpsNotesResult, saveExpertOpsNotes } from "@/features/experts/actions";
import { useFormAction } from "@/hooks/use-form-action";

export type OpsNotesEditorProps = {
  readonly expertId: string;
  readonly notes: string;
};

/**
 * The ops record check notes on an expert (spec 0013, AC-8). Ops only in every sense: the table's
 * policies refuse the expert, so this editor is the one way the note is written and the expert
 * never sees what it says.
 *
 * A plain textarea in local state rather than a form library: one optional field with one length
 * rule that the action re checks, so a resolver would only repeat the server. Browser.
 */
export function OpsNotesEditor({ expertId, notes }: OpsNotesEditorProps) {
  const t = useTranslations("experts.notes");
  const router = useRouter();
  const [value, setValue] = useState(notes);
  const action = useFormAction<OpsNotesResult, { expertId: string; notes: string }>(
    saveExpertOpsNotes,
  );
  const result = action.result;

  useEffect(() => {
    if (result?.ok) {
      toast.success(t("saved"));
      router.refresh();
    }
  }, [result, router, t]);

  return (
    <div className="flex flex-col gap-4" data-expert-notes>
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}
      <Field>
        <FieldLabel htmlFor="ops-notes">{t("label")}</FieldLabel>
        <Textarea
          id="ops-notes"
          rows={5}
          maxLength={4000}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-describedby="ops-notes-hint"
        />
        <FieldDescription id="ops-notes-hint">{t("hint")}</FieldDescription>
      </Field>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={action.pending || value === notes}
          onClick={() => action.submit({ expertId, notes: value })}
        >
          {action.pending ? t("saving") : t("submit")}
        </Button>
      </div>
    </div>
  );
}
