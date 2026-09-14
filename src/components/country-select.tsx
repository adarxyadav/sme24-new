"use client";

import { useLocale } from "next-intl";
import { useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALE_CODE, resolveLocale } from "@/i18n/routing";
import { COUNTRIES, countryName, isEuropean } from "@/lib/countries";

export type CountrySelectProps = {
  readonly id: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder: string;
  /** The two group headings, Europe first (spec 0022, AC-1). */
  readonly europeLabel: string;
  readonly restLabel: string;
  readonly invalid?: boolean;
  readonly describedBy?: string;
  readonly disabled?: boolean;
};

/**
 * The country select shared by the lookup, rerun and facts forms (spec 0022, AC-1): every ISO
 * 3166 alpha 2 code, named by `Intl.DisplayNames` in the page locale so no per country message
 * key exists, sorted by that name and grouped with the catalogue's 32 European codes first.
 * Browser.
 */
export function CountrySelect({
  id,
  value,
  onValueChange,
  placeholder,
  europeLabel,
  restLabel,
  invalid,
  describedBy,
  disabled,
}: CountrySelectProps) {
  // `useLocale` answers the catalog tag (`en-CH`), while the catalogue keys its display locales
  // by the short code the database and the URL use; passing the tag straight through would name
  // every country by its own code.
  const locale = LOCALE_CODE[resolveLocale(useLocale())];
  // The names come from the runtime, so the sort has to happen here rather than in the
  // catalogue, and it changes with the locale.
  const groups = useMemo(() => {
    const named = COUNTRIES.map((country) => ({
      code: country.code,
      name: countryName(country.code, locale),
      european: isEuropean(country.code),
    })).sort((a, b) => a.name.localeCompare(b.name, locale));
    return {
      europe: named.filter((country) => country.european),
      rest: named.filter((country) => !country.european),
    };
  }, [locale]);

  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={id}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className="w-full"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>{europeLabel}</SelectLabel>
          {groups.europe.map((country) => (
            <SelectItem key={country.code} value={country.code}>
              {country.name}
            </SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>{restLabel}</SelectLabel>
          {groups.rest.map((country) => (
            <SelectItem key={country.code} value={country.code}>
              {country.name}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
