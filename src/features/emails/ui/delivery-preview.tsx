import { FileWarningIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import type { PreviewResult } from "@/lib/email/render";

/**
 * The rerendered email of a delivery inside a fully sandboxed frame (spec 0006, AC-9): no
 * scripts, no navigation, no same origin access, the HTML only. A render failure shows an
 * explained empty state. Server component.
 */
export async function DeliveryPreview({ preview }: { readonly preview: PreviewResult }) {
  const t = await getTranslations("emails.preview");
  if (!preview.ok) {
    return (
      <EmptyState
        icon={FileWarningIcon}
        title={preview.error === "unknown_template" ? t("unknownTemplate") : t("renderFailed")}
        description={t("description")}
      />
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">{t("description")}</p>
      <iframe
        title={t("frameTitle")}
        sandbox=""
        srcDoc={preview.html}
        className="h-[42rem] w-full rounded-lg border bg-background"
      />
    </div>
  );
}
