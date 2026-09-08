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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type InviteExpertResult, inviteExpert } from "@/features/experts/actions";
import {
  type InviteExpertInput,
  type InviteExpertValues,
  inviteExpertSchema,
} from "@/features/experts/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { useRouter as useIntlRouter } from "@/i18n/navigation";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { issueMessage, zodLocaleError } from "@/lib/validation";

/** The two languages an invited expert can be written to; the app's own locales. */
const INVITE_LOCALES = ["de", "en"] as const;

/**
 * The ops invite form on `/admin/experts/new` (spec 0013, AC-2, AC-7): the address, the name ops
 * know the expert by and the language every email to them is written in. The role is deliberately
 * absent: `inviteExpert` hard codes `expert`, so no form field can ever raise someone to ops.
 *
 * A success navigates to the new expert's page rather than back to the list, because the next
 * thing ops do is assign them. Browser.
 */
export function ExpertInviteForm() {
  const t = useTranslations("experts.invite");
  const errorText = useTranslations("experts.form.errors");
  const locale = useLocale();
  const router = useRouter();
  const intlRouter = useIntlRouter();

  const form = useForm<InviteExpertInput, unknown, InviteExpertValues>({
    resolver: zodResolver(inviteExpertSchema, { error: zodLocaleError(locale) }),
    // The invitee's language starts at the language ops are reading in, which is almost always the
    // language they picked the expert's name up in.
    defaultValues: { email: "", fullName: "", locale: LOCALE_CODE[resolveLocale(locale)] },
  });
  const action = useFormAction<InviteExpertResult, InviteExpertValues>(inviteExpert);
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (!result?.ok) return;
    toast.success(t("sent"));
    intlRouter.push({
      pathname: "/admin/experts/[expertId]",
      params: { expertId: result.data.expertId },
    });
    router.refresh();
  }, [result, intlRouter, router, t]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit(values))}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
      data-expert-invite
    >
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="invite-email">{t("email")}</FieldLabel>
          <Input
            id="invite-email"
            type="email"
            autoComplete="off"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "invite-email-error" : "invite-email-hint"}
            {...form.register("email")}
          />
          <FieldDescription id="invite-email-hint">{t("emailHint")}</FieldDescription>
          <FieldError id="invite-email-error">
            {issueMessage(errors.email?.message, errorText)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.fullName ? true : undefined}>
          <FieldLabel htmlFor="invite-full-name">{t("fullName")}</FieldLabel>
          <Input
            id="invite-full-name"
            autoComplete="off"
            aria-invalid={errors.fullName ? true : undefined}
            aria-describedby={errors.fullName ? "invite-full-name-error" : undefined}
            {...form.register("fullName")}
          />
          <FieldError id="invite-full-name-error">
            {issueMessage(errors.fullName?.message, errorText)}
          </FieldError>
        </Field>

        <Controller
          control={form.control}
          name="locale"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="invite-locale">{t("language")}</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="invite-locale" className="w-full sm:max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITE_LOCALES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {t(`languages.${code}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>{t("languageHint")}</FieldDescription>
            </Field>
          )}
        />
      </FieldGroup>

      <div>
        <Button type="submit" disabled={action.pending}>
          {action.pending ? t("sending") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
