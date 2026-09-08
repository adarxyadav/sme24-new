"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Example } from "@/components/gallery/gallery-section";
import { Combobox } from "@/components/ui/combobox";
import { Field, FieldLabel } from "@/components/ui/field";
import { ExpertAvatar } from "@/features/experts/ui/expert-avatar";

/**
 * The two primitives spec 0013 added (AC-6, AC-9): the searchable Combobox behind the ops
 * organization picker, and the avatar that falls back to initials when an expert has no photo.
 * Both appear here so axe scans them on every run, which is the point of the gallery.
 *
 * A client section, because the combobox is interactive; the page hands it the `gallery`
 * namespace through its own provider. Browser.
 */
export function ExpertsSection() {
  const t = useTranslations("gallery");
  const [organization, setOrganization] = useState<string | null>("musterfirma");

  return (
    <>
      <Example label={t("expertAvatar")}>
        <div className="flex flex-wrap items-end gap-6">
          {/* The three states the list and the client card actually render. */}
          <div className="flex flex-col items-center gap-2">
            <ExpertAvatar fullName="Erika Muster" photoUrl={null} />
            <span className="text-muted-foreground text-xs">{t("avatarInitials")}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ExpertAvatar fullName="Beat von der Weid" photoUrl={null} />
            <span className="text-muted-foreground text-xs">{t("avatarTwoWords")}</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <ExpertAvatar fullName={null} photoUrl={null} />
            <span className="text-muted-foreground text-xs">{t("avatarUnnamed")}</span>
          </div>
        </div>
      </Example>

      <Example label={t("combobox")}>
        {/* Labelled the way the ops picker labels it: a Combobox renders a button, so without an
            associated label it reaches axe with no accessible name. */}
        <Field className="w-full max-w-sm">
          <FieldLabel htmlFor="gallery-combobox">{t("comboboxLabel")}</FieldLabel>
          <Combobox
            id="gallery-combobox"
            options={[
              { value: "musterfirma", label: "Musterfirma AG", description: "Musterfirma AG" },
              { value: "beispiel", label: "Beispiel GmbH", description: "Beispiel Bau GmbH" },
              { value: "no-company", label: "Ohne Firma AG", description: null },
            ]}
            value={organization}
            onValueChange={setOrganization}
            placeholder={t("comboboxPlaceholder")}
            searchPlaceholder={t("comboboxSearch")}
            emptyLabel={t("comboboxEmpty")}
          />
        </Field>
      </Example>
    </>
  );
}
