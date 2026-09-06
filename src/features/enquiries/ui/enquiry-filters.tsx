"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_STATUSES, ENQUIRY_STATUSES, type EnquiryFilters } from "@/features/enquiries/schema";
import { Link } from "@/i18n/navigation";

/**
 * The status filter of `/admin/enquiries` (spec 0009, AC-12): a plain GET form, so the URL
 * carries the state and a reload or a shared link shows the same list. Client component (the
 * select needs the browser).
 */
export function EnquiryFilterForm({ filters }: { readonly filters: EnquiryFilters }) {
  const t = useTranslations("enquiries");
  return (
    <form method="get" className="rounded-lg border p-6">
      <FieldSet>
        <FieldLegend>{t("filters.legend")}</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="filter-status">{t("filters.status")}</FieldLabel>
            <Select name="status" defaultValue={filters.status}>
              <SelectTrigger id="filter-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENQUIRY_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`status.${status}`)}
                  </SelectItem>
                ))}
                <SelectItem value={ALL_STATUSES}>{t("filters.all")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/enquiries">{t("filters.reset")}</Link>
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
