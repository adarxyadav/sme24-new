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
import type { PeerActionResult, ProposePeersData } from "@/features/peers/actions";
import { proposePeers } from "@/features/peers/actions";
import { PEER_SECTIONS, PEER_SIZE_BANDS } from "@/features/peers/catalogue";
import {
  type ProposePeersInput,
  type ProposePeersValues,
  proposePeersSchema,
} from "@/features/peers/schema";
import { useFormAction } from "@/hooks/use-form-action";
import { issueMessage, zodLocaleError } from "@/lib/validation";

export type ProposePeersFormProps = {
  /** The section and band the list is filtered to, prefilled so the candidates land in view. */
  readonly section?: string;
  readonly sizeBand?: string;
};

/**
 * The proposal form (spec 0012, AC-2): the section, the band and how many candidates to ask the
 * model for. A success shows how many candidates were stored as proposed and refreshes the list;
 * nothing is researched until ops approve a candidate. Browser; the page hands it the `peers`
 * and `benchmark` messages.
 */
export function ProposePeersForm({ section, sizeBand }: ProposePeersFormProps) {
  const t = useTranslations("peers");
  const v = useTranslations("peers.validation");
  const b = useTranslations("benchmark");
  const locale = useLocale();
  const router = useRouter();
  const form = useForm<ProposePeersInput, unknown, ProposePeersValues>({
    resolver: zodResolver(proposePeersSchema, { error: zodLocaleError(locale) }),
    defaultValues: {
      section: section ?? "C",
      sizeBand: (sizeBand as ProposePeersInput["sizeBand"] | undefined) ?? "50-249",
      count: 10,
      locale,
    },
  });
  const action = useFormAction<PeerActionResult<ProposePeersData>, ProposePeersValues>(
    proposePeers,
  );
  const { errors } = form.formState;
  const result = action.result;

  useEffect(() => {
    if (!result?.ok) return;
    toast.success(
      result.data.proposed === 0
        ? t("propose.none")
        : t("propose.proposed", { count: result.data.proposed }),
    );
    router.refresh();
  }, [result, router, t]);

  return (
    <form
      noValidate
      onSubmit={form.handleSubmit((values) => action.submit({ ...values, locale }))}
      aria-busy={action.pending}
      className="flex flex-col gap-6"
      data-propose-peers-form
    >
      {result?.ok === false ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden="true" />
          <AlertTitle>{t(`errors.${result.error}`)}</AlertTitle>
        </Alert>
      ) : null}
      <FieldGroup>
        <Controller
          control={form.control}
          name="section"
          render={({ field }) => (
            <Field data-invalid={errors.section ? true : undefined}>
              <FieldLabel htmlFor="propose-section">{t("propose.section")}</FieldLabel>
              <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="propose-section" className="w-full">
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
              <FieldError id="propose-section-error">
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
              <FieldLabel htmlFor="propose-size-band">{t("propose.sizeBand")}</FieldLabel>
              <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="propose-size-band" className="w-full">
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
              <FieldError id="propose-size-band-error">
                {issueMessage(errors.sizeBand?.message, v)}
              </FieldError>
            </Field>
          )}
        />
        <Field data-invalid={errors.count ? true : undefined}>
          <FieldLabel htmlFor="propose-count">{t("propose.count")}</FieldLabel>
          <Input
            id="propose-count"
            type="number"
            inputMode="numeric"
            min={1}
            max={10}
            aria-invalid={errors.count ? true : undefined}
            aria-describedby={errors.count ? "propose-count-error" : undefined}
            {...form.register("count")}
          />
          <FieldError id="propose-count-error">{issueMessage(errors.count?.message, v)}</FieldError>
        </Field>
      </FieldGroup>
      <div>
        <Button type="submit" variant="outline" disabled={action.pending}>
          {action.pending ? t("propose.submitting") : t("propose.submit")}
        </Button>
      </div>
    </form>
  );
}
