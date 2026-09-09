"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon, AlertTriangleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type UpdateDataRequestResult, updateDataRequest } from "@/features/legal/actions";
import {
  DATA_REQUEST_TRANSITIONS,
  type DataRequestKind,
  type DataRequestStatus,
  type UpdateDataRequestInput,
  type UpdateDataRequestValues,
  updateDataRequestSchema,
} from "@/features/legal/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { issueMessage, zodLocaleError } from "@/lib/validation";

export type DataRequestFormProps = {
  readonly id: string;
  readonly kind: DataRequestKind;
  readonly status: DataRequestStatus;
  readonly opsNote: string | null;
};

/**
 * The ops workflow form of one data request (spec 0015, AC-14, AC-15).
 *
 * The select offers the current status plus exactly the moves `DATA_REQUEST_TRANSITIONS` allows
 * from it, so an illegal move is not something the UI can even express; the action checks the same
 * list again against the stored status, because a stale page is still a possible caller.
 *
 * A terminal request has no moves, so the whole form is replaced by a line saying so rather than
 * shown disabled: there is nothing to do here, and a greyed out form invites a try.
 *
 * Fulfilling a deletion anonymises the person, so that choice carries a warning the moment it is
 * selected, before the save rather than after it. Browser; the page hands it the
 * `adminDataRequests` messages through a nested provider.
 */
export function DataRequestForm({ id, kind, status, opsNote }: DataRequestFormProps) {
  const t = useTranslations("adminDataRequests");
  // The note's rule carries a key of `adminDataRequests.form.errors` (`noteLong`), so its own translator.
  const errorText = useTranslations("adminDataRequests.form.errors");
  const locale = useLocale();
  const router = useRouter();
  const moves = DATA_REQUEST_TRANSITIONS[status];
  const form = useForm<UpdateDataRequestInput, unknown, UpdateDataRequestValues>({
    resolver: zodResolver(updateDataRequestSchema, { error: zodLocaleError(locale) }),
    defaultValues: { id, status, opsNote: opsNote ?? "", locale },
  });
  const action = useFormAction<UpdateDataRequestResult, UpdateDataRequestValues>(updateDataRequest);
  const { errors } = form.formState;
  const next = form.watch("status");

  // Only the two terminal statuses reach this branch, and only they have a `terminal.*` key. The
  // narrowing is on the status rather than on `moves.length`, because the empty adjacency list and
  // the message catalogue have to agree and TypeScript can check the second form.
  if (status === "fulfilled" || status === "refused") {
    return <p className="text-muted-foreground text-sm">{t(`terminal.${status}`)}</p>;
  }

  const save = async (values: UpdateDataRequestValues) => {
    const result = await action.submit({ ...values, locale });
    // The success work sits in the handler that awaited this dispatch, never in an effect watching
    // `result`: `useActionState` keeps its last value for the life of the component, so an effect
    // would toast the same save again on every later render.
    if (result.ok) {
      toast.success(t("form.saved"));
      router.refresh();
    }
  };

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit(save)}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
    >
      {action.result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`form.errors.${action.result.error}`)}</AlertTitle>
        </Alert>
      ) : null}
      <FieldGroup>
        <Controller
          control={form.control}
          name="status"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="data-request-status">{t("form.status")}</FieldLabel>
              <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="data-request-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* The status it is in now, so "no change plus a note" stays possible, then the
                      moves the adjacency list allows out of it. */}
                  <SelectItem value={status}>{t(`status.${status}`)}</SelectItem>
                  {moves.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {t(`status.${entry}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        {kind === "deletion" && next === "fulfilled" ? (
          <Alert variant="destructive">
            <AlertTriangleIcon aria-hidden="true" />
            <AlertTitle>{t("form.deletionWarningTitle")}</AlertTitle>
            <AlertDescription>{t("form.deletionWarning")}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={errors.opsNote ? true : undefined}>
          <FieldLabel htmlFor="data-request-ops-note">{t("form.opsNote")}</FieldLabel>
          <Textarea
            id="data-request-ops-note"
            rows={5}
            required={next === "refused"}
            aria-invalid={errors.opsNote ? true : undefined}
            aria-describedby={
              errors.opsNote ? "data-request-ops-note-error" : "data-request-ops-note-hint"
            }
            {...form.register("opsNote")}
          />
          <FieldDescription id="data-request-ops-note-hint">
            {t("form.opsNoteHint")}
          </FieldDescription>
          <FieldError id="data-request-ops-note-error">
            {issueMessage(errors.opsNote?.message, errorText)}
          </FieldError>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={action.pending}>
          {action.pending ? t("form.saving") : t("form.submit")}
        </Button>
      </div>
    </form>
  );
}
