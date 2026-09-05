import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { DeliveryStatus } from "@/lib/email/schema";

type Variant = "outline" | "info" | "success" | "warning" | "destructive";

const VARIANTS: Record<DeliveryStatus, Variant> = {
  queued: "outline",
  sending: "info",
  sent: "info",
  delivered: "success",
  bounced: "destructive",
  complained: "destructive",
  failed: "destructive",
  skipped: "warning",
};

/** True when `value` is one of the eight delivery statuses. Pure. */
export function isDeliveryStatus(value: string): value is DeliveryStatus {
  return Object.hasOwn(VARIANTS, value);
}

/**
 * The status of a delivery as a labelled badge (spec 0006, AC-9): the label comes from
 * `emails.status`, the color only underlines it. Server and client components.
 */
export function DeliveryStatusBadge({ status }: { readonly status: string }) {
  const t = useTranslations("emails.status");
  if (!isDeliveryStatus(status)) return <Badge variant="outline">{status}</Badge>;
  return (
    <Badge variant={VARIANTS[status]} data-status={status}>
      {t(status)}
    </Badge>
  );
}
