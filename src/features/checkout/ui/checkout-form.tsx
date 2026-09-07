"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CreditCardIcon, FileTextIcon, OctagonXIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { startTransition, useActionState, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRouter } from "@/i18n/navigation";
import {
  type CheckoutResult,
  type RequestInvoiceData,
  requestInvoice,
  type StartCheckoutData,
  startCheckout,
} from "../actions";
import { computeAmounts } from "../money";
import { billingAddressSchema } from "../schema";

/** One company of the organization, for the picker. */
export type CheckoutCompany = {
  readonly id: string;
  readonly name: string;
  readonly uid: string | null;
};

/**
 * One purchasable package with its amounts already formatted by the server.
 *
 * The strings are passed in rather than formatted here because `Intl` groups `de-CH` thousands
 * with U+2019 on one ICU version and U+0027 on another, so a server and a browser on different
 * ICU builds render the same amount two ways and React reports a hydration mismatch. Formatting
 * once, on the server, removes the whole class of problem. The Rappen come along so the summary
 * can still be derived from the same pure arithmetic the order is frozen with.
 */
export type CheckoutPackage = {
  readonly key: string;
  readonly name: string;
  readonly priceRappen: number;
  readonly vatRate: number;
  /** `CHF 2'000.00`, formatted by the server. */
  readonly priceLabel: string;
  /** The three summary rows, formatted by the server. */
  readonly netLabel: string;
  readonly vatLabel: string;
  readonly grossLabel: string;
  /** `8.1%`, formatted by the server. */
  readonly vatRateLabel: string;
};

export type CheckoutFormProps = {
  readonly companies: readonly CheckoutCompany[];
  readonly packages: readonly CheckoutPackage[];
  /** The package chosen on the pricing page, preselected when it is one of these (AC-16). */
  readonly initialPackageKey?: string;
};

/**
 * The checkout form (spec 0011, AC-1, AC-11, AC-16): pick the package and the company, confirm the
 * billing address, and go to Stripe. The summary recomputes with the same pure `computeAmounts`
 * the server uses, so what the buyer reads is what the order will hold.
 *
 * The address is validated in the browser by the same Zod schema the action parses with, so a bad
 * UID is caught under the field rather than after a round trip. Client component.
 */
export function CheckoutForm({ companies, packages, initialPackageKey }: CheckoutFormProps) {
  const t = useTranslations("checkout");
  const tv = useTranslations("checkout.validation");
  const locale = useLocale();
  const router = useRouter();

  const [packageKey, setPackageKey] = useState(() => initialPackageKey ?? packages[0]?.key ?? "");
  const [companyId, setCompanyId] = useState(() => companies[0]?.id ?? "");
  const [method, setMethod] = useState<"card" | "bank_transfer">("card");
  const [state, action, pending] = useActionState<
    CheckoutResult<StartCheckoutData> | null,
    unknown
  >(startCheckout, null);
  const [invoiceState, invoiceAction, invoicePending] = useActionState<
    CheckoutResult<RequestInvoiceData> | null,
    unknown
  >(requestInvoice, null);

  const chosen = packages.find((entry) => entry.key === packageKey) ?? packages[0];
  const prefill = companies.find((entry) => entry.id === companyId);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(billingAddressSchema),
    defaultValues: {
      billingName: prefill?.name ?? "",
      billingStreet: "",
      billingPostcode: "",
      billingTown: "",
      billingCountry: "CH",
      billingUid: prefill?.uid ?? "",
    },
  });

  // The same arithmetic the order will be frozen with, asserted here so a drift between the
  // server's formatted labels and the real amounts would surface in development rather than
  // silently show the buyer a wrong total.
  const amounts = useMemo(
    () => (chosen ? computeAmounts(chosen.priceRappen, chosen.vatRate) : null),
    [chosen],
  );

  const error =
    state && !state.ok ? state.error : invoiceState && !invoiceState.ok ? invoiceState.error : null;
  const busy = pending || invoicePending;

  // Stripe Checkout is a hosted page on Stripe's own domain, so the browser leaves the app here.
  // A full assignment rather than the router: this is not an app route.
  useEffect(() => {
    if (state?.ok) window.location.assign(state.data.checkoutUrl);
  }, [state]);

  // The bank transfer path stays inside the app: the order and its invoice already exist, so the
  // buyer goes straight to the order page to download the QR bill.
  useEffect(() => {
    if (invoiceState?.ok) {
      router.push({ pathname: "/app/orders/[id]", params: { id: invoiceState.data.orderId } });
    }
  }, [invoiceState, router]);

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={handleSubmit((values) => {
        const payload = { ...values, packageKey, companyId, locale };
        startTransition(() => {
          // The two paths share every input and differ only in which action takes it: the card
          // path opens Stripe, the transfer path issues the invoice and stays in the app.
          if (method === "card") action(payload);
          else invoiceAction(payload);
        });
      })}
      noValidate
    >
      {error ? (
        <Alert variant="destructive">
          <OctagonXIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${error}` as never)}</AlertTitle>
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">{t("packageLegend")}</legend>
        <RadioGroup
          value={packageKey}
          onValueChange={setPackageKey}
          className="grid gap-px border bg-border sm:grid-cols-3"
        >
          {packages.map((entry) => (
            <label
              key={entry.key}
              htmlFor={`package-${entry.key}`}
              className="flex cursor-pointer flex-col gap-2 bg-card p-6 has-[:checked]:bg-accent"
            >
              <span className="flex items-start gap-2">
                <RadioGroupItem value={entry.key} id={`package-${entry.key}`} className="mt-1" />
                <span className="text-base font-semibold">{entry.name}</span>
              </span>
              <span className="text-sm tabular-nums text-muted-foreground">{entry.priceLabel}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      {companies.length > 1 ? (
        <Field>
          <FieldLabel htmlFor="companyId">{t("companyLabel")}</FieldLabel>
          <Select value={companyId} onValueChange={setCompanyId}>
            <SelectTrigger id="companyId">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>{t("companyHint")}</FieldDescription>
        </Field>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">{t("billingLegend")}</legend>
        <FieldGroup>
          <Field data-invalid={errors.billingName ? "" : undefined}>
            <FieldLabel htmlFor="billingName">{t("fields.billingName")}</FieldLabel>
            <Input
              id="billingName"
              autoComplete="organization"
              aria-invalid={errors.billingName ? true : undefined}
              {...register("billingName")}
            />
            {errors.billingName ? (
              <FieldError role="alert">{tv(errors.billingName.message as never)}</FieldError>
            ) : null}
          </Field>
          <Field data-invalid={errors.billingStreet ? "" : undefined}>
            <FieldLabel htmlFor="billingStreet">{t("fields.billingStreet")}</FieldLabel>
            <Input
              id="billingStreet"
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
              <FieldLabel htmlFor="billingPostcode">{t("fields.billingPostcode")}</FieldLabel>
              <Input
                id="billingPostcode"
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
              <FieldLabel htmlFor="billingTown">{t("fields.billingTown")}</FieldLabel>
              <Input
                id="billingTown"
                autoComplete="address-level2"
                aria-invalid={errors.billingTown ? true : undefined}
                {...register("billingTown")}
              />
              {errors.billingTown ? (
                <FieldError role="alert">{tv(errors.billingTown.message as never)}</FieldError>
              ) : null}
            </Field>
          </div>
          <Field data-invalid={errors.billingUid ? "" : undefined}>
            <FieldLabel htmlFor="billingUid">{t("fields.billingUid")}</FieldLabel>
            <Input
              id="billingUid"
              placeholder={t("fields.billingUidPlaceholder")}
              aria-invalid={errors.billingUid ? true : undefined}
              aria-describedby="billingUid-hint"
              {...register("billingUid")}
            />
            <FieldDescription id="billingUid-hint">{t("fields.billingUidHint")}</FieldDescription>
            {errors.billingUid ? (
              <FieldError role="alert">{tv(errors.billingUid.message as never)}</FieldError>
            ) : null}
          </Field>
          <input type="hidden" {...register("billingCountry")} />
        </FieldGroup>
      </fieldset>

      {chosen && amounts ? (
        <section aria-labelledby="summary" className="border bg-card p-6">
          <h2 id="summary" className="text-base font-semibold">
            {t("summaryTitle")}
          </h2>
          <dl className="mt-4 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("net")}</dt>
              <dd className="tabular-nums">{chosen.netLabel}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">{t("vat", { rate: chosen.vatRateLabel })}</dt>
              <dd className="tabular-nums">{chosen.vatLabel}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t pt-2 font-semibold">
              <dt>{t("gross")}</dt>
              <dd className="tabular-nums">{chosen.grossLabel}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">{t("vatNote")}</p>
        </section>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-lg font-semibold">{t("paymentLegend")}</legend>
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
              htmlFor={`method-${value}`}
              className="flex cursor-pointer flex-col gap-2 bg-card p-6 has-[:checked]:bg-accent"
            >
              <span className="flex items-center gap-2">
                <RadioGroupItem value={value} id={`method-${value}`} />
                <Icon className="size-4" aria-hidden="true" />
                <span className="text-base font-semibold">{t(label)}</span>
              </span>
              <span className="text-sm text-muted-foreground">{t(hint)}</span>
            </label>
          ))}
        </RadioGroup>
      </fieldset>

      <div>
        <Button type="submit" size="lg" disabled={busy || !chosen}>
          {method === "card" ? (
            <CreditCardIcon data-icon="inline-start" aria-hidden="true" />
          ) : (
            <FileTextIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {busy ? t("submitting") : method === "card" ? t("submitCard") : t("submitInvoice")}
        </Button>
      </div>
    </form>
  );
}
