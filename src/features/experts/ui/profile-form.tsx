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
import { Textarea } from "@/components/ui/textarea";
import { type ExpertProfileResult, updateExpertProfile } from "@/features/experts/actions";
import {
  AVAILABILITY_CODES,
  EXPERT_CATALOGUE,
  EXPERT_LIST_NAMES,
  type ExpertListName,
} from "@/features/experts/catalogue";
import {
  type ExpertProfileInput,
  type ExpertProfileValues,
  expertProfileSchema,
} from "@/features/experts/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { CodeCheckboxGroup } from "./code-checkbox-group";

export type ExpertProfileFormProps = {
  /** The row's current values, already shaped for the form by the page. */
  readonly defaults: ExpertProfileInput;
  /**
   * Today in Europe/Zurich, taken on the server so the browser's own clock and time zone never
   * decide whether an availability date is in the past.
   */
  readonly today: string;
  /** Set by the ops page only; the expert's own form leaves it undefined and writes their row. */
  readonly expertId?: string;
};

/** How many columns each catalogue list wants: the 26 cantons need more than the three competencies. */
const LIST_COLUMNS: Record<ExpertListName, 2 | 3 | 4> = {
  competencies: 2,
  industries: 3,
  standards: 3,
  languages: 2,
  regions: 4,
};

/**
 * The full expert profile (spec 0013, AC-5): everything ops and a client see about an expert, in
 * one form used in two places, `/expert/profile` for the expert and the ops expert page. One
 * component rather than two because the fields, the rules and the action are the same; only
 * `expertId` differs, and the action refuses it from anyone but ops.
 *
 * The date rule is checked against a server supplied `today` rather than `new Date()` in the
 * browser: an expert on a device set to yesterday would otherwise be told a valid date is past.
 * Browser.
 */
export function ExpertProfileForm({ defaults, today, expertId }: ExpertProfileFormProps) {
  const t = useTranslations("experts.profile");
  const errorText = useTranslations("experts.form.errors");
  const catalogue = useTranslations("experts.catalogue");
  const locale = useLocale();
  const router = useRouter();

  const form = useForm<ExpertProfileInput, unknown, ExpertProfileValues>({
    resolver: zodResolver(expertProfileSchema(today), { error: zodLocaleError(locale) }),
    defaultValues: { ...defaults, expertId, locale },
  });
  const action = useFormAction<ExpertProfileResult, ExpertProfileValues>(updateExpertProfile);
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (result?.ok) {
      toast.success(t("saved"));
      router.refresh();
    }
  }, [result, router, t]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, expertId, locale }))}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
      data-expert-profile-form
    >
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}

      <FieldGroup>
        <Field data-invalid={errors.headline ? true : undefined}>
          <FieldLabel htmlFor="profile-headline">{t("headline")}</FieldLabel>
          <Input
            id="profile-headline"
            aria-invalid={errors.headline ? true : undefined}
            aria-describedby={errors.headline ? "profile-headline-error" : undefined}
            {...form.register("headline")}
          />
          <FieldError id="profile-headline-error">
            {issueMessage(errors.headline?.message, errorText)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.bio ? true : undefined}>
          <FieldLabel htmlFor="profile-bio">{t("bio")}</FieldLabel>
          <Textarea
            id="profile-bio"
            rows={5}
            aria-invalid={errors.bio ? true : undefined}
            aria-describedby={errors.bio ? "profile-bio-error" : "profile-bio-hint"}
            {...form.register("bio")}
          />
          <FieldDescription id="profile-bio-hint">{t("bioHint")}</FieldDescription>
          <FieldError id="profile-bio-error">
            {issueMessage(errors.bio?.message, errorText)}
          </FieldError>
        </Field>

        {EXPERT_LIST_NAMES.map((name) => (
          <Controller
            key={name}
            control={form.control}
            name={name}
            render={({ field, fieldState }) => (
              <CodeCheckboxGroup
                codes={EXPERT_CATALOGUE[name]}
                value={field.value ?? []}
                onValueChange={(value) => field.onChange([...value])}
                labelFor={(code) => catalogue(`${name}.${code}` as "languages.de")}
                legend={t(`lists.${name}`)}
                error={issueMessage(fieldState.error?.message, errorText)}
                idPrefix={`profile-${name}`}
                columns={LIST_COLUMNS[name]}
              />
            )}
          />
        ))}

        <Controller
          control={form.control}
          name="availability"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="profile-availability">{t("availability")}</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="profile-availability" className="w-full sm:max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AVAILABILITY_CODES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {catalogue(`availability.${code}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        <Field data-invalid={errors.availableFrom ? true : undefined}>
          <FieldLabel htmlFor="profile-available-from">{t("availableFrom")}</FieldLabel>
          <Input
            id="profile-available-from"
            type="date"
            min={today}
            className="w-full sm:max-w-xs"
            aria-invalid={errors.availableFrom ? true : undefined}
            aria-describedby={errors.availableFrom ? "profile-available-from-error" : undefined}
            {...form.register("availableFrom")}
          />
          <FieldError id="profile-available-from-error">
            {issueMessage(errors.availableFrom?.message, errorText)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.availabilityNote ? true : undefined}>
          <FieldLabel htmlFor="profile-availability-note">{t("availabilityNote")}</FieldLabel>
          <Input
            id="profile-availability-note"
            aria-invalid={errors.availabilityNote ? true : undefined}
            aria-describedby={
              errors.availabilityNote ? "profile-availability-note-error" : undefined
            }
            {...form.register("availabilityNote")}
          />
          <FieldError id="profile-availability-note-error">
            {issueMessage(errors.availabilityNote?.message, errorText)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.yearsExperience ? true : undefined}>
          <FieldLabel htmlFor="profile-years">{t("yearsExperience")}</FieldLabel>
          <Input
            id="profile-years"
            type="number"
            min={0}
            max={60}
            inputMode="numeric"
            className="w-full sm:max-w-[10rem]"
            aria-invalid={errors.yearsExperience ? true : undefined}
            aria-describedby={errors.yearsExperience ? "profile-years-error" : undefined}
            {...form.register("yearsExperience")}
          />
          <FieldError id="profile-years-error">
            {issueMessage(errors.yearsExperience?.message, errorText)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="profile-phone">{t("phone")}</FieldLabel>
          <Input
            id="profile-phone"
            type="tel"
            autoComplete="tel"
            className="w-full sm:max-w-xs"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "profile-phone-error" : undefined}
            {...form.register("phone")}
          />
          <FieldError id="profile-phone-error">
            {issueMessage(errors.phone?.message, errorText)}
          </FieldError>
        </Field>
      </FieldGroup>

      <div>
        <Button type="submit" disabled={action.pending}>
          {action.pending ? t("saving") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
