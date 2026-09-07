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
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type AddPeerData, addPeer, type PeerActionResult } from "@/features/peers/actions";
import { PEER_SECTIONS, PEER_SIZE_BANDS } from "@/features/peers/catalogue";
import { type AddPeerInput, type AddPeerValues, addPeerSchema } from "@/features/peers/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { issueMessage, zodLocaleError } from "@/lib/validation";

export type AddPeerFormProps = {
  /** The section and band the list is filtered to, prefilled so a hand added peer lands in view. */
  readonly section?: string;
  readonly sizeBand?: string;
};

/**
 * The hand added peer form (spec 0012, AC-1): name, legal name, website, section and band. A
 * success shows a toast, clears the form and refreshes the list. Browser; the page hands it the
 * `peers` and `benchmark` messages.
 */
export function AddPeerForm({ section, sizeBand }: AddPeerFormProps) {
  const t = useTranslations("peers");
  const v = useTranslations("peers.validation");
  const b = useTranslations("benchmark");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<AddPeerInput, unknown, AddPeerValues>({
    resolver: zodResolver(addPeerSchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      name: "",
      legalName: "",
      website: "",
      section: section ?? "",
      sizeBand: (sizeBand as AddPeerInput["sizeBand"] | undefined) ?? "50-249",
      locale,
    },
  });
  const action = useFormAction<PeerActionResult<AddPeerData>, AddPeerValues>(addPeer);
  const { errors } = form.formState;
  const result = action.result;
  const reset = form.reset;

  useEffect(() => {
    if (result?.ok) {
      toast.success(t("add.added"));
      reset({
        name: "",
        legalName: "",
        website: "",
        section: section ?? "",
        sizeBand: "50-249",
        locale,
      });
      router.refresh();
    }
  }, [result, reset, router, t, section, locale]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
      data-add-peer-form
    >
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}
      <FieldGroup>
        <Field data-invalid={errors.name ? true : undefined}>
          <FieldLabel htmlFor="peer-name">{t("add.name")}</FieldLabel>
          <Input
            id="peer-name"
            autoComplete="organization"
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "peer-name-error" : undefined}
            {...form.register("name")}
          />
          <FieldError id="peer-name-error">{issueMessage(errors.name?.message, v)}</FieldError>
        </Field>
        <Field data-invalid={errors.legalName ? true : undefined}>
          <FieldLabel htmlFor="peer-legal-name">{t("add.legalName")}</FieldLabel>
          <Input
            id="peer-legal-name"
            aria-invalid={errors.legalName ? true : undefined}
            aria-describedby={errors.legalName ? "peer-legal-name-error" : undefined}
            {...form.register("legalName")}
          />
          <FieldError id="peer-legal-name-error">
            {issueMessage(errors.legalName?.message, v)}
          </FieldError>
        </Field>
        <Field data-invalid={errors.website ? true : undefined}>
          <FieldLabel htmlFor="peer-website">{t("add.website")}</FieldLabel>
          <Input
            id="peer-website"
            inputMode="url"
            autoComplete="url"
            placeholder={t("add.websitePlaceholder")}
            aria-invalid={errors.website ? true : undefined}
            aria-describedby={errors.website ? "peer-website-error" : undefined}
            {...form.register("website")}
          />
          <FieldError id="peer-website-error">
            {issueMessage(errors.website?.message, v)}
          </FieldError>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            control={form.control}
            name="section"
            render={({ field }) => (
              <Field data-invalid={errors.section ? true : undefined}>
                <FieldLabel htmlFor="peer-section">{t("add.section")}</FieldLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="peer-section"
                    className="w-full"
                    aria-invalid={errors.section ? true : undefined}
                    aria-describedby={errors.section ? "peer-section-error" : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEER_SECTIONS.map((letter) => (
                      <SelectItem key={letter} value={letter}>
                        {letter} · {b(`noga.sections.${letter as "A"}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="peer-section-error">
                  {issueMessage(errors.section?.message, v)}
                </FieldError>
              </Field>
            )}
          />
          <Controller
            control={form.control}
            name="sizeBand"
            render={({ field }) => (
              <Field data-invalid={errors.sizeBand ? true : undefined}>
                <FieldLabel htmlFor="peer-size-band">{t("add.sizeBand")}</FieldLabel>
                <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id="peer-size-band"
                    className="w-full"
                    aria-invalid={errors.sizeBand ? true : undefined}
                    aria-describedby={errors.sizeBand ? "peer-size-band-error" : undefined}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PEER_SIZE_BANDS.map((band) => (
                      <SelectItem key={band} value={band}>
                        {b(`sizeBands.${band}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError id="peer-size-band-error">
                  {issueMessage(errors.sizeBand?.message, v)}
                </FieldError>
              </Field>
            )}
          />
        </div>
      </FieldGroup>
      <div>
        <Button type="submit" disabled={action.pending}>
          {action.pending ? t("add.submitting") : t("add.submit")}
        </Button>
      </div>
    </form>
  );
}
