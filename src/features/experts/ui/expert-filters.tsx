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
import { EXPERT_STATUSES } from "@/features/experts/catalogue";
import { ALL_STATUSES, type ExpertFilters } from "@/features/experts/schema";
import { Link } from "@/i18n/navigation";

/**
 * The status filter of `/admin/experts` (spec 0013, AC-7): a plain GET form, so the URL carries
 * the state and a reload or a shared link shows the same list. The cursor is deliberately not a
 * field here: submitting the filter starts the list again from the newest row, which is what
 * changing a filter means. Browser (the select needs it).
 */
export function ExpertFilterForm({ filters }: { readonly filters: ExpertFilters }) {
  const t = useTranslations("experts.admin");
  return (
    <form method="get" className="rounded-lg border p-6">
      <FieldSet>
        <FieldLegend>{t("filters.legend")}</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="filter-status">{t("filters.status")}</FieldLabel>
            <Select name="status" defaultValue={filters.status}>
              <SelectTrigger id="filter-status" className="w-full sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STATUSES}>{t("filters.all")}</SelectItem>
                {EXPERT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/experts">{t("filters.reset")}</Link>
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
