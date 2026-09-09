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
import {
  ALL_DATA_REQUEST_STATUSES,
  DATA_REQUEST_STATUSES,
  type DataRequestFilters,
} from "@/features/legal/schema";

/**
 * The status filter of `/admin/data-requests` (spec 0015, AC-13): a plain GET form, so the URL
 * carries the state and a reload or a shared link shows the same list.
 *
 * "Open" is first and is the default, because it is the queue with a deadline attached; the four
 * named statuses and "All" follow it. Browser (the select needs it).
 */
export function DataRequestFilterForm({ filters }: { readonly filters: DataRequestFilters }) {
  const t = useTranslations("adminDataRequests");
  return (
    <form method="get" className="rounded-lg border p-6">
      <FieldSet>
        <FieldLegend>{t("filters.label")}</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="filter-status">{t("filters.label")}</FieldLabel>
            <Select name="status" defaultValue={filters.status}>
              <SelectTrigger id="filter-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">{t("filters.open")}</SelectItem>
                {DATA_REQUEST_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`status.${status}`)}
                  </SelectItem>
                ))}
                <SelectItem value={ALL_DATA_REQUEST_STATUSES}>{t("filters.all")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
