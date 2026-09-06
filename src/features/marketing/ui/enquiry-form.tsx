"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Controller, type FieldErrors, useForm } from "react-hook-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type EnquiryActionResult, submitEnquiry } from "@/features/marketing/actions";
import {
  ENQUIRY_TOPICS,
  type EnquiryInput,
  type EnquiryTopic,
  type EnquiryValues,
  enquirySchema,
  HEADCOUNT_BANDS,
  MESSAGE_MAX,
} from "@/features/marketing/schema";
import { SITE } from "@/features/marketing/site";
import { useFormAction } from "@/hooks/use-form-action";
import { LOCALE_CODE } from "@/i18n/routing";
import { issueMessage, zodLocaleError } from "@/lib/validation";
import { EnquiryConfirmation } from "./enquiry-confirmation";

export type EnquiryFormProps = {
  /** The preselected topic: `retainer` from the pricing page's link, else `general`. */
  readonly defaultTopic: EnquiryTopic;
  /** The privacy page once feature 14 ships it; until then the note renders without a link. */
  readonly privacyHref?: string;
};

const FIELD_ORDER = [
  "topic",
  "companyName",
  "contactName",
  "email",
  "phone",
  "headcountBand",
  "message",
] as const;
type FieldName = (typeof FIELD_ORDER)[number];

/**
 * The enquiry form of the contact page (spec 0009, AC-8, AC-10): React Hook Form with the
 * feature schema, inline errors plus an announced summary, a live character count, the honeypot
 * and the mount time the server checks, and the confirmation panel after a successful submit.
 * Browser; the page hands it the `marketing` messages through a nested provider.
 */
export function EnquiryForm({ defaultTopic, privacyHref }: EnquiryFormProps) {
  const t = useTranslations("marketing.contact.form");
  const e = useTranslations("marketing.contact.form.errors");
  const locale = useLocale();
  const form = useForm<EnquiryInput, unknown, EnquiryValues>({
    resolver: zodResolver(enquirySchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      topic: defaultTopic,
      companyName: "",
      contactName: "",
      email: "",
      phone: "",
      headcountBand: "",
      message: "",
      locale: LOCALE_CODE[locale],
    },
  });
  const action = useFormAction<EnquiryActionResult, unknown>(submitEnquiry);
  // Set on the client after mount: a prerendered page would bake one build time value for every visitor.
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [summary, setSummary] = useState<readonly FieldName[]>([]);
  const websiteRef = useRef<HTMLInputElement>(null);
  const { errors } = form.formState;
  const errorText = (message: string | undefined) => issueMessage(message, e);
  const messageLength = form.watch("message")?.length ?? 0;
  const result = action.result;

  useEffect(() => {
    setStartedAt(String(Date.now()));
  }, []);

  useEffect(() => {
    if (result?.ok === false && result.error === "validation") {
      for (const [name, message] of Object.entries(result.fields)) {
        if (isFieldName(name)) form.setError(name, { type: "server", message });
      }
      setSummary(FIELD_ORDER.filter((name) => name in result.fields));
    }
  }, [result, form]);

  if (result?.ok) return <EnquiryConfirmation />;

  const onSubmit = form.handleSubmit(
    (values) => {
      setSummary([]);
      action.submit({
        ...values,
        locale: LOCALE_CODE[locale],
        website: websiteRef.current?.value ?? "",
        startedAt: startedAt ?? "",
      });
    },
    (invalid: FieldErrors<EnquiryInput>) => {
      setSummary(FIELD_ORDER.filter((name) => name in invalid));
    },
  );
  const serverError = result?.ok === false && result.error !== "validation" ? result.error : null;

  return (
    <form
      noValidate
      method="post"
      onSubmit={onSubmit}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
    >
      {summary.length > 0 ? (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t("summaryTitle")}</AlertTitle>
          <AlertDescription>
            <ul className="flex list-disc flex-col gap-1 pl-4">
              {summary.map((name) => (
                <li key={name}>
                  <a href={`#enquiry-${name}`} className="underline underline-offset-4">
                    {t(`fields.${name}`)}
                  </a>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {serverError ? (
        <Alert variant="destructive" role="alert">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>
            {serverError === "rate_limited"
              ? e("rateLimited", { email: SITE.email })
              : e("unavailable", { email: SITE.email })}
          </AlertTitle>
        </Alert>
      ) : null}

      <FieldGroup>
        <Controller
          control={form.control}
          name="topic"
          render={({ field }) => (
            <FieldSet id="enquiry-topic">
              <FieldLegend variant="label">{t("fields.topic")}</FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange} name={field.name}>
                {ENQUIRY_TOPICS.map((topic) => (
                  <Field key={topic} orientation="horizontal">
                    <RadioGroupItem id={`enquiry-topic-${topic}`} value={topic} />
                    <div className="flex flex-col gap-0.5">
                      <FieldLabel htmlFor={`enquiry-topic-${topic}`} className="font-normal">
                        {t(`topics.${topic}`)}
                      </FieldLabel>
                      <FieldDescription>{t(`topicHints.${topic}`)}</FieldDescription>
                    </div>
                  </Field>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />

        <Field data-invalid={errors.companyName ? true : undefined}>
          <FieldLabel htmlFor="enquiry-companyName">{t("fields.companyName")}</FieldLabel>
          <Input
            id="enquiry-companyName"
            autoComplete="organization"
            aria-invalid={errors.companyName ? true : undefined}
            aria-describedby={errors.companyName ? "enquiry-companyName-error" : undefined}
            {...form.register("companyName")}
          />
          <FieldError id="enquiry-companyName-error">
            {errorText(errors.companyName?.message)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.contactName ? true : undefined}>
          <FieldLabel htmlFor="enquiry-contactName">{t("fields.contactName")}</FieldLabel>
          <Input
            id="enquiry-contactName"
            autoComplete="name"
            aria-invalid={errors.contactName ? true : undefined}
            aria-describedby={errors.contactName ? "enquiry-contactName-error" : undefined}
            {...form.register("contactName")}
          />
          <FieldError id="enquiry-contactName-error">
            {errorText(errors.contactName?.message)}
          </FieldError>
        </Field>

        <Field data-invalid={errors.email ? true : undefined}>
          <FieldLabel htmlFor="enquiry-email">{t("fields.email")}</FieldLabel>
          <Input
            id="enquiry-email"
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? "enquiry-email-error" : undefined}
            {...form.register("email")}
          />
          <FieldError id="enquiry-email-error">{errorText(errors.email?.message)}</FieldError>
        </Field>

        <Field data-invalid={errors.phone ? true : undefined}>
          <FieldLabel htmlFor="enquiry-phone">{t("fields.phone")}</FieldLabel>
          <Input
            id="enquiry-phone"
            type="tel"
            autoComplete="tel"
            aria-invalid={errors.phone ? true : undefined}
            aria-describedby={errors.phone ? "enquiry-phone-error" : undefined}
            {...form.register("phone")}
          />
          <FieldError id="enquiry-phone-error">{errorText(errors.phone?.message)}</FieldError>
        </Field>

        <Controller
          control={form.control}
          name="headcountBand"
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="enquiry-headcountBand">{t("fields.headcountBand")}</FieldLabel>
              <Select
                name={field.name}
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="enquiry-headcountBand" className="w-full">
                  <SelectValue placeholder={t("headcountPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {HEADCOUNT_BANDS.map((band) => (
                    <SelectItem key={band} value={band}>
                      {t(`bands.${band}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        <Field data-invalid={errors.message ? true : undefined}>
          <FieldLabel htmlFor="enquiry-message">{t("fields.message")}</FieldLabel>
          <Textarea
            id="enquiry-message"
            rows={6}
            aria-invalid={errors.message ? true : undefined}
            aria-describedby={
              errors.message
                ? "enquiry-message-error enquiry-message-count"
                : "enquiry-message-hint"
            }
            {...form.register("message")}
          />
          <FieldDescription id="enquiry-message-hint">{t("messageHint")}</FieldDescription>
          <FieldDescription id="enquiry-message-count" aria-live="polite">
            {t("characterCount", { count: messageLength, max: MESSAGE_MAX })}
          </FieldDescription>
          <FieldError id="enquiry-message-error">{errorText(errors.message?.message)}</FieldError>
        </Field>
      </FieldGroup>

      {/* The honeypot (AC-10): out of sight and out of the tab order; a filled value marks a bot. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="enquiry-website">{t("honeypot")}</label>
        <input
          ref={websiteRef}
          id="enquiry-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <p className="max-w-prose text-muted-foreground text-sm">
        {t.rich("privacyNote", {
          link: (chunks) =>
            privacyHref ? (
              <a href={privacyHref} className="underline underline-offset-4">
                {chunks}
              </a>
            ) : (
              <span>{chunks}</span>
            ),
        })}
      </p>

      <Button type="submit" size="lg" disabled={action.pending}>
        {action.pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}

function isFieldName(value: string): value is FieldName {
  return (FIELD_ORDER as readonly string[]).includes(value);
}
