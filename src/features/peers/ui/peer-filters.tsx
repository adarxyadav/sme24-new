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
import { PEER_SECTIONS, PEER_SIZE_BANDS, PEER_STATUSES } from "@/features/peers/catalogue";
import { ALL, type PeerFilters } from "@/features/peers/schema";
import { Link } from "@/i18n/navigation";

/**
 * The section, band and status filter of `/admin/peers` (spec 0012, AC-2): a plain GET form, so
 * the URL carries the state and a reload or a shared link shows the same list. Browser (the
 * selects need it); the page hands it the `peers` and `benchmark` messages.
 */
export function PeerFilterForm({ filters }: { readonly filters: PeerFilters }) {
  const t = useTranslations("peers");
  const b = useTranslations("benchmark");
  return (
    <form method="get" className="rounded-lg border p-6">
      <FieldSet>
        <FieldLegend>{t("filters.legend")}</FieldLegend>
        <FieldGroup className="grid gap-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
          <Field>
            <FieldLabel htmlFor="filter-section">{t("filters.section")}</FieldLabel>
            <Select name="section" defaultValue={filters.section}>
              <SelectTrigger id="filter-section" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
                {PEER_SECTIONS.map((section) => (
                  <SelectItem key={section} value={section}>
                    {section} · {b(`noga.sections.${section as "A"}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-size-band">{t("filters.sizeBand")}</FieldLabel>
            <Select name="sizeBand" defaultValue={filters.sizeBand}>
              <SelectTrigger id="filter-size-band" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
                {PEER_SIZE_BANDS.map((band) => (
                  <SelectItem key={band} value={band}>
                    {b(`sizeBands.${band}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="filter-status">{t("filters.status")}</FieldLabel>
            <Select name="status" defaultValue={filters.status}>
              <SelectTrigger id="filter-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("filters.all")}</SelectItem>
                {PEER_STATUSES.map((status) => (
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
              <Link href="/admin/peers">{t("filters.reset")}</Link>
            </Button>
          </div>
        </FieldGroup>
      </FieldSet>
    </form>
  );
}
