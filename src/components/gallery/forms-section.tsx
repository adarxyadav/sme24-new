"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { issueMessage, zodLocaleError } from "@/lib/validation";

/**
 * Custom rules carry a key of `gallery.validation`, translated where they render; `email` and
 * `message` keep Zod's built in messages, which arrive in the request language through the
 * resolver's locale map (spec 0004, AC-8).
 */
const demoSchema = z.object({
  company: z.string().min(2, "companyShort"),
  email: z.email(),
  canton: z.string().min(1, "cantonRequired"),
  plan: z.enum(["starter", "growth", "enterprise"], "planRequired"),
  message: z.string().max(200),
  notify: z.boolean(),
  consent: z.boolean().refine((value) => value === true, "consentRequired"),
});

type DemoValues = z.infer<typeof demoSchema>;
type DemoInput = z.input<typeof demoSchema>;

const CANTONS = ["ZH", "BE", "LU", "BS", "GE", "VD"] as const;

/**
 * Form controls in every state (AC-6, AC-8): a React Hook Form plus Zod form whose field errors
 * render inline under the field with `aria-invalid` and `aria-describedby`, plus disabled and
 * pre invalid examples. Runs in the browser.
 */
export function FormsSection() {
  const t = useTranslations("gallery.forms");
  const v = useTranslations("gallery.validation");
  const locale = useLocale();
  const form = useForm<DemoInput, unknown, DemoValues>({
    resolver: zodResolver(demoSchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      company: "",
      email: "",
      canton: "",
      message: "",
      notify: true,
      consent: false,
    },
  });
  const { errors, isSubmitting } = form.formState;
  const errorText = (message: string | undefined) => issueMessage(message, v);

  return (
    <div className="grid gap-12 lg:grid-cols-[minmax(0,42rem)_minmax(0,20rem)]">
      <form
        noValidate
        onSubmit={form.handleSubmit(() => {
          toast.success(t("submitted"));
          form.reset();
        })}
        className="flex flex-col gap-6 rounded-lg border p-6"
      >
        <FieldGroup>
          <Field data-invalid={errors.company ? true : undefined}>
            <FieldLabel htmlFor="demo-company">{t("company")}</FieldLabel>
            <Input
              id="demo-company"
              aria-invalid={errors.company ? true : undefined}
              aria-describedby={errors.company ? "demo-company-error" : undefined}
              autoComplete="organization"
              {...form.register("company")}
            />
            <FieldError id="demo-company-error">{errorText(errors.company?.message)}</FieldError>
          </Field>

          <Field data-invalid={errors.email ? true : undefined}>
            <FieldLabel htmlFor="demo-email">{t("email")}</FieldLabel>
            <Input
              id="demo-email"
              type="email"
              autoComplete="email"
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "demo-email-error" : "demo-email-hint"}
              {...form.register("email")}
            />
            <FieldDescription id="demo-email-hint">{t("emailHint")}</FieldDescription>
            <FieldError id="demo-email-error">{errorText(errors.email?.message)}</FieldError>
          </Field>

          <Controller
            control={form.control}
            name="canton"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid ? true : undefined}>
                <FieldLabel htmlFor="demo-canton">{t("canton")}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="demo-canton"
                    aria-invalid={fieldState.invalid ? true : undefined}
                    aria-describedby={fieldState.invalid ? "demo-canton-error" : undefined}
                    className="w-full"
                  >
                    <SelectValue placeholder={t("cantonPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {CANTONS.map((canton) => (
                        <SelectItem key={canton} value={canton}>
                          {canton}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError id="demo-canton-error">
                  {errorText(fieldState.error?.message)}
                </FieldError>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="plan"
            render={({ field, fieldState }) => (
              <FieldSet data-invalid={fieldState.invalid ? true : undefined}>
                <FieldLegend>{t("plan")}</FieldLegend>
                <RadioGroup
                  value={field.value ?? ""}
                  onValueChange={field.onChange}
                  aria-invalid={fieldState.invalid ? true : undefined}
                  aria-describedby={fieldState.invalid ? "demo-plan-error" : undefined}
                >
                  {(["starter", "growth", "enterprise"] as const).map((plan) => (
                    <Field key={plan} orientation="horizontal">
                      <RadioGroupItem value={plan} id={`demo-plan-${plan}`} />
                      <FieldLabel htmlFor={`demo-plan-${plan}`} className="font-normal">
                        {t(`plans.${plan}`)}
                      </FieldLabel>
                    </Field>
                  ))}
                </RadioGroup>
                <FieldError id="demo-plan-error">{errorText(fieldState.error?.message)}</FieldError>
              </FieldSet>
            )}
          />

          <Field data-invalid={errors.message ? true : undefined}>
            <FieldLabel htmlFor="demo-message">{t("message")}</FieldLabel>
            <Textarea
              id="demo-message"
              rows={3}
              aria-invalid={errors.message ? true : undefined}
              aria-describedby={errors.message ? "demo-message-error" : undefined}
              {...form.register("message")}
            />
            <FieldError id="demo-message-error">{errorText(errors.message?.message)}</FieldError>
          </Field>

          <Controller
            control={form.control}
            name="notify"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Switch id="demo-notify" checked={field.value} onCheckedChange={field.onChange} />
                <FieldLabel htmlFor="demo-notify" className="font-normal">
                  {t("notify")}
                </FieldLabel>
              </Field>
            )}
          />

          <Controller
            control={form.control}
            name="consent"
            render={({ field, fieldState }) => (
              <Field orientation="horizontal" data-invalid={fieldState.invalid ? true : undefined}>
                <Checkbox
                  id="demo-consent"
                  checked={field.value === true}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                  aria-invalid={fieldState.invalid ? true : undefined}
                  aria-describedby={fieldState.invalid ? "demo-consent-error" : undefined}
                />
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="demo-consent" className="font-normal">
                    {t("consent")}
                  </FieldLabel>
                  <FieldError id="demo-consent-error">
                    {errorText(fieldState.error?.message)}
                  </FieldError>
                </div>
              </Field>
            )}
          />
        </FieldGroup>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={isSubmitting}>
            {t("submit")}
          </Button>
          <Button type="button" variant="ghost" onClick={() => form.reset()}>
            {t("reset")}
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-6 rounded-lg border p-6">
        <Field data-invalid>
          <FieldLabel htmlFor="demo-invalid">{t("invalidExample")}</FieldLabel>
          <Input
            id="demo-invalid"
            defaultValue="acme"
            aria-invalid
            aria-describedby="demo-invalid-error"
          />
          <FieldError id="demo-invalid-error">{v("emailInvalid")}</FieldError>
        </Field>
        <Field data-disabled>
          <FieldLabel htmlFor="demo-disabled">{t("disabledExample")}</FieldLabel>
          <Input id="demo-disabled" disabled defaultValue="Muster AG" />
          <FieldDescription>{t("disabledHint")}</FieldDescription>
        </Field>
        <Field orientation="horizontal" data-disabled>
          <Checkbox id="demo-disabled-check" disabled defaultChecked />
          <FieldLabel htmlFor="demo-disabled-check" className="font-normal">
            {t("disabledCheckbox")}
          </FieldLabel>
        </Field>
      </div>
    </div>
  );
}
