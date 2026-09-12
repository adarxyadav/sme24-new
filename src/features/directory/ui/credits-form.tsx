"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCardIcon, FileTextIcon, OctagonXIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { billingAddressSchema } from "@/features/checkout/schema";
import type { CreditPackKey } from "@/features/directory/catalogue";
import { useFormAction } from "@/hooks/use-form-action";
import { useRouter } from "@/i18n/navigation";
import {
  type CreditCheckoutError,
  type CreditCheckoutResult,
  type RequestCreditInvoiceData,
  requestCreditInvoice,
  type StartCreditCheckoutData,
  startCreditCheckout,
} from "../actions";

export type CreditsFormProps = {
  readonly packKey: CreditPackKey;
  /** The expert's name, prefilled as the billing name. */
  readonly billingName: string;
};

/** The billing fields the form validates; the country is fixed and never a field (AC-9). */
const formSchema = billingAddressSchema.omit({ billingCountry: true });

/**
 * The credit pack purchase form (spec 0018, AC-9): the billing address for a Swiss buyer and the
 * two payment methods. Card leaves the app for Stripe's hosted page; invoice stays in the app and
 * returns to this page with the order. Every success step happens in the submit handler that
 * awaited the action, never in an effect on the result. Browser.
 */
export function CreditsForm({ packKey, billingName }: CreditsFormProps) {
  const t = useTranslations("directory.credits");
  const tc = useTranslations("checkout");
  const tv = useTranslations("checkout.validation");
  const locale = useLocale();
  const router = useRouter();
  const [method, setMethod] = useState<"card" | "bank_transfer">("card");
  const [failure, setFailure] = useState<CreditCheckoutError | null>(null);
  const card = useFormAction<CreditCheckoutResult<StartCreditCheckoutData>, unknown>(
    startCreditCheckout,
  );
  const invoice = useFormAction<CreditCheckoutResult<RequestCreditInvoiceData>, unknown>(
    requestCreditInvoice,
  );
  const busy = card.pending || invoice.pending;

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      billingName,
      billingStreet: "",
      billingPostcode: "",
      billingTown: "",
      billingUid: "",
    },
  });

  const submit = handleSubmit(async (values) => {
    setFailure(null);
    const payload = { ...values, packKey, paymentMethod: method, locale };
    if (method === "card") {
      const outcome = await card.submit(payload);
      if (!outcome.ok) {
        setFailure(outcome.error);
        return;
      }
      // Stripe Checkout is a hosted page on Stripe's own domain: a full assignment, not the router.
      window.location.assign(outcome.data.checkoutUrl);
      return;
    }
    const outcome = await invoice.submit(payload);
    if (!outcome.ok) {
      setFailure(outcome.error);
      return;
    }
    router.push({ pathname: "/expert/directory/credits", query: { order: outcome.data.orderId } });
  });

  return (
    <form className="flex flex-col gap-8" onSubmit={submit} noValidate>
      {failure ? (
        <Alert variant="destructive">
          <OctagonXIcon aria-hidden="true" />
          <AlertTitle>{tc(`errors.${failure}`)}</AlertTitle>
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold text-lg">{t("form.legend")}</legend>
        <FieldGroup>
          <Field data-invalid={errors.billingName ? "" : undefined}>
            <FieldLabel htmlFor="credits-billingName">{t("form.billingName")}</FieldLabel>
            <Input
              id="credits-billingName"
              autoComplete="name"
              aria-invalid={errors.billingName ? true : undefined}
              {...register("billingName")}
            />
            {errors.billingName ? (
              <FieldError role="alert">{tv(errors.billingName.message as never)}</FieldError>
            ) : null}
          </Field>
          <Field data-invalid={errors.billingStreet ? "" : undefined}>
            <FieldLabel htmlFor="credits-billingStreet">{tc("fields.billingStreet")}</FieldLabel>
            <Input
              id="credits-billingStreet"
              autoComplete="street-address"
              aria-invalid={errors.billingStreet ? true : undefined}
              {...register("billingStreet")}
            />
            {errors.billingStreet ? (
              <FieldError role="alert">{tv(errors.billingStreet.message as never)}</FieldError>
            ) : null}
          </Field>
          <div className="flex flex-col gap-4 sm:flex-row">
            <Field className="sm:w-32" data-invalid={errors.billingPostcode ? "" : undefined}>
              <FieldLabel htmlFor="credits-billingPostcode">
                {tc("fields.billingPostcode")}
              </FieldLabel>
              <Input
                id="credits-billingPostcode"
                autoComplete="postal-code"
                inputMode="numeric"
                aria-invalid={errors.billingPostcode ? true : undefined}
                {...register("billingPostcode")}
              />
              {errors.billingPostcode ? (
                <FieldError role="alert">{tv(errors.billingPostcode.message as never)}</FieldError>
              ) : null}
            </Field>
            <Field className="flex-1" data-invalid={errors.billingTown ? "" : undefined}>
              <FieldLabel htmlFor="credits-billingTown">{tc("fields.billingTown")}</FieldLabel>
              <Input
                id="credits-billingTown"
                autoComplete="address-level2"
                aria-invalid={errors.billingTown ? true : undefined}
                {...register("billingTown")}
              />
              {errors.billingTown ? (
                <FieldError role="alert">{tv(errors.billingTown.message as never)}</FieldError>
              ) : null}
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="credits-country">{t("form.country")}</FieldLabel>
            <Input id="credits-country" value={t("form.countryValue")} readOnly aria-readonly />
            <FieldDescription>{t("pack.billedTo")}</FieldDescription>
          </Field>
          <Field data-invalid={errors.billingUid ? "" : undefined}>
            <FieldLabel htmlFor="credits-billingUid">{tc("fields.billingUid")}</FieldLabel>
            <Input
              id="credits-billingUid"
              placeholder={tc("fields.billingUidPlaceholder")}
              aria-invalid={errors.billingUid ? true : undefined}
              aria-describedby="credits-billingUid-hint"
              {...register("billingUid")}
            />
            <FieldDescription id="credits-billingUid-hint">{t("form.uidHint")}</FieldDescription>
            {errors.billingUid ? (
              <FieldError role="alert">{tv(errors.billingUid.message as never)}</FieldError>
            ) : null}
          </Field>
        </FieldGroup>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="font-semibold text-lg">{tc("paymentLegend")}</legend>
        <RadioGroup
          value={method}
          onValueChange={(value) => setMethod(value as "card" | "bank_transfer")}
          className="grid gap-px border bg-border sm:grid-cols-2"
        >
          {(
            [
              ["card", "methodCard", "methodCardHint", CreditCardIcon],
              ["bank_transfer", "methodInvoice", "methodInvoiceHint", FileTextIcon],
            ] as const
          ).map(([value, label, hint, Icon]) => (
            <label
              key={value}
              htmlFor={`credits-method-${value}`}
              className="flex cursor-pointer flex-col gap-2 bg-card p-6 has-[:checked]:bg-accent"
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`credits-method-${value}`} />
                <Icon className="size-4" aria-hidden="true" />
                <span className="font-semibold text-base">{tc(label)}</span>
              </span>
              <span className="text-muted-foreground text-sm">{tc(hint)}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <div>
        <Button type="submit" size="lg" disabled={busy} aria-busy={busy || undefined}>
          {method === "card" ? (
            <CreditCardIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <FileTextIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {busy ? tc("submitting") : method === "card" ? tc("submitCard") : tc("submitInvoice")}
        </Button>
      </div>
    </form>
  );
}
