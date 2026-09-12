"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon, UserXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFormAction } from "@/hooks/use-form-action";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { issueMessage } from "@/lib/validation";
import {
  type RemoveContactData,
  type RemoveContactError,
  type RemoveContactResult,
  removeDirectoryContact,
} from "../actions";
import { REMOVAL_REASONS, type RemovalReason, removeContactSchema } from "../schema";

/**
 * The "Remove a person" form of /admin/directory (spec 0018, AC-15): an email address and a
 * reason. The outcome, removed or only suppressed, and the unlocks the removal cost the buyers,
 * are shown in the submit handler that awaited the action; the list refreshes so the totals move.
 * The address never leaves the form except into the action's own parse. Browser, ops only.
 */
export function RemoveContactForm() {
  const t = useTranslations("directory.admin.remove");
  const locale = resolveLocale(useLocale());
  const router = useRouter();
  const remove = useFormAction<RemoveContactResult, unknown>(removeDirectoryContact);
  const [reason, setReason] = useState<RemovalReason>("data_subject_request");
  const [outcome, setOutcome] = useState<RemoveContactData | null>(null);
  const [failure, setFailure] = useState<RemoveContactError | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(removeContactSchema.omit({ reason: true, locale: true })),
    defaultValues: { email: "" },
  });

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    setOutcome(null);
    const result = await remove.submit({ ...values, reason, locale: LOCALE_CODE[locale] });
    if (!result.ok) {
      setFailure(result.error);
      return;
    }
    setOutcome(result.data);
    reset();
    router.refresh();
  });

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
      {failure ? (
        <Alert variant="destructive">
          <OctagonXIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${failure}`)}</AlertTitle>
        </Alert>
      ) : null}
      {outcome ? (
        <Alert variant={outcome.outcome === "removed" ? "success" : "info"} aria-live="polite">
          <AlertTitle>
            {outcome.outcome === "removed"
              ? t("removed", { count: outcome.unlocksCascaded })
              : t("notFound")}
          </AlertTitle>
        </Alert>
      ) : null}
      <FieldGroup className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
        <Field data-invalid={errors.email ? "" : undefined}>
          <FieldLabel htmlFor="remove-email">{t("email")}</FieldLabel>
          <Input
            id="remove-email"
            type="email"
            autoComplete="off"
            aria-invalid={errors.email ? true : undefined}
            {...register("email")}
          />
          {errors.email ? (
            <FieldError role="alert">
              {issueMessage(errors.email.message, t as never) ?? t("errors.emailInvalid")}
            </FieldError>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor="remove-reason">{t("reason")}</FieldLabel>
          <Select value={reason} onValueChange={(value) => setReason(value as RemovalReason)}>
            <SelectTrigger id="remove-reason" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REMOVAL_REASONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`reasons.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Button
          type="submit"
          variant="destructive"
          disabled={remove.pending}
          aria-busy={remove.pending || undefined}
        >
          <UserXIcon aria-hidden="true" data-icon="inline-start" />
          {remove.pending ? t("submitting") : t("submit")}
        </Button>
      </FieldGroup>
    </form>
  );
}
