"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { DeliveryFilters } from "@/features/emails/schema";
import { Link } from "@/i18n/navigation";
import { DELIVERY_STATUSES, EMAIL_TEMPLATE_NAMES } from "@/lib/email/schema";

/** The select value that means "no filter"; the filter schema turns it into undefined. */
const ALL = "all";

/**
 * The status, template and recipient filters of `/admin/emails` (spec 0006, AC-9): a plain GET
 * form, so the URL carries the state and a reload or a shared link shows the same list. Client
 * component (the select needs the browser).
 */
export function DeliveryFilterForm({ filters }: { readonly filters: DeliveryFilters }) {
  const t = useTranslations("emails");
  return (
    <form method="get" className="rounded-lg border p-6">
      <FieldSet>
        <FieldLegend>{t("filters.legend")}</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end">
          <Field>
            <FieldLabel htmlFor="filter-status">{t("filters.status")}</FieldLabel>
            <Select name="status" defaultValue={filters.status ?? ALL}>
              <SelectTrigger id="filter-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
                {DELIVERY_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {t(`status.${status}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-template">{t("filters.template")}</FieldLabel>
            <Select name="template" defaultValue={filters.template ?? ALL}>
              <SelectTrigger id="filter-template" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
                {EMAIL_TEMPLATE_NAMES.map((template) => (
                  <SelectItem key={template} value={template}>
                    {template}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-q">{t("filters.search")}</FieldLabel>
            <Input
              id="filter-q"
              name="q"
              type="search"
              defaultValue={filters.q ?? ""}
              placeholder={t("filters.searchPlaceholder")}
              autoComplete="off"
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">{t("filters.apply")}</Button>
            <Button asChild variant="ghost">
              <Link href="/admin/emails">{t("filters.reset")}</Link>
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
