"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertTitle } from "@/components/ui/alert";
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
import { type UpdateEnquiryResult, updateEnquiry } from "@/features/enquiries/actions";
import {
  ENQUIRY_STATUSES,
  type EnquiryStatus,
  type UpdateEnquiryInput,
  type UpdateEnquiryValues,
  updateEnquirySchema,
} from "@/features/enquiries/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { issueMessage, zodLocaleError } from "@/lib/validation";

export type EnquiryStatusFormProps = {
  readonly id: string;
  readonly status: EnquiryStatus;
  readonly opsNote: string | null;
};

/**
 * The workflow form of an enquiry (spec 0009, AC-12): the status select and the ops note. A
 * success shows a toast and refreshes the page so the server renders the new state. Browser;
 * the page hands it the `enquiries` messages through a nested provider.
 */
export function EnquiryStatusForm({ id, status, opsNote }: EnquiryStatusFormProps) {
  const t = useTranslations("enquiries");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<UpdateEnquiryInput, unknown, UpdateEnquiryValues>({
    resolver: zodResolver(updateEnquirySchema, { error: zodLocaleError(locale) }),
    defaultValues: { id, status, opsNote: opsNote ?? "", locale },
  });
  const action = useFormAction<UpdateEnquiryResult, UpdateEnquiryValues>(updateEnquiry);
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (result?.ok) {
      toast.success(t("form.saved"));
      router.refresh();
    }
  }, [result, router, t]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
    >
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`form.errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}
      <FieldGroup>
        <Controller
          control={form.control}
          name="status"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="enquiry-status">{t("form.status")}</FieldLabel>
              <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="enquiry-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENQUIRY_STATUSES.map((entry) => (
                    <SelectItem key={entry} value={entry}>
                      {t(`status.${entry}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Field data-invalid={errors.opsNote ? true : undefined}>
          <FieldLabel htmlFor="enquiry-ops-note">{t("form.opsNote")}</FieldLabel>
          <Textarea
            id="enquiry-ops-note"
            rows={5}
            aria-invalid={errors.opsNote ? true : undefined}
            aria-describedby={errors.opsNote ? "enquiry-ops-note-error" : "enquiry-ops-note-hint"}
            {...form.register("opsNote")}
          />
          <FieldDescription id="enquiry-ops-note-hint">{t("form.opsNoteHint")}</FieldDescription>
          <FieldError id="enquiry-ops-note-error">
            {issueMessage(errors.opsNote?.message, t)}
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
