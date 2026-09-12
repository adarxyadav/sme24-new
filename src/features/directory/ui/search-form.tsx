"use client";

import { SearchIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_COUNTRIES } from "@/features/directory/schema";
import { Link } from "@/i18n/navigation";

export type CountryOption = {
  readonly code: string;
  /** The country name in the reader's language, from Intl.DisplayNames on the server. */
  readonly label: string;
  readonly contacts: number;
};

export type SearchFormValues = {
  readonly q: string;
  readonly title: string;
  readonly country: string;
};

export type SearchFormErrors = {
  readonly q?: "tooShort" | "tooLong";
  readonly title?: "tooShort" | "tooLong";
};

type Props = {
  readonly values: SearchFormValues;
  readonly errors: SearchFormErrors;
  readonly countries: readonly CountryOption[];
};

/**
 * The directory search (spec 0018, AC-5): company, job title and country as a plain GET form, so
 * the URL carries the search and a reload or a shared link shows the same page. The cursor is
 * deliberately not a field: submitting starts the results again from the first page, which is
 * what changing a search means. A refused value (one character) comes back from the page as an
 * inline error under its field. Browser (the select needs it).
 */
export function DirectorySearchForm({ values, errors, countries }: Props) {
  const t = useTranslations("directory.search");
  return (
    <form method="get" className="rounded-lg border p-6">
      <FieldSet>
        <FieldLegend>{t("legend")}</FieldLegend>
        <FieldGroup className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto] md:items-end">
          <Field data-invalid={errors.q ? true : undefined}>
            <FieldLabel htmlFor="directory-q">{t("company")}</FieldLabel>
            <Input
              id="directory-q"
              name="q"
              defaultValue={values.q}
              placeholder={t("companyPlaceholder")}
              autoComplete="off"
              maxLength={100}
              aria-invalid={errors.q ? true : undefined}
              aria-describedby={errors.q ? "directory-q-error" : undefined}
            />
            {errors.q ? (
              <FieldError id="directory-q-error">{t(`errors.${errors.q}`)}</FieldError>
            ) : null}
          </Field>
          <Field data-invalid={errors.title ? true : undefined}>
            <FieldLabel htmlFor="directory-title">{t("title")}</FieldLabel>
            <Input
              id="directory-title"
              name="title"
              defaultValue={values.title}
              placeholder={t("titlePlaceholder")}
              autoComplete="off"
              maxLength={100}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "directory-title-error" : undefined}
            />
            {errors.title ? (
              <FieldError id="directory-title-error">{t(`errors.${errors.title}`)}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="directory-country">{t("country")}</FieldLabel>
            <Select name="country" defaultValue={values.country || ALL_COUNTRIES}>
              <SelectTrigger id="directory-country" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COUNTRIES}>{t("allCountries")}</SelectItem>
                {countries.map((country) => (
                  <SelectItem key={country.code} value={country.code}>
                    {t("countryOption", { label: country.label, count: country.contacts })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">
              <SearchIcon aria-hidden="true" data-icon="inline-start" />
              {t("submit")}
            </Button>
            <Button asChild variant="ghost">
              <Link href="/expert/directory">{t("reset")}</Link>
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
