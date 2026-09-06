import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { ENQUIRY_STATUSES, type EnquiryStatus } from "@/features/enquiries/schema";

type Variant = "info" | "warning" | "outline";

const VARIANTS: Record<EnquiryStatus, Variant> = {
  new: "info",
  contacted: "warning",
  closed: "outline",
};

/** True when `value` is one of the three enquiry statuses. Pure. */
export function isEnquiryStatus(value: string): value is EnquiryStatus {
  return (ENQUIRY_STATUSES as readonly string[]).includes(value);
}

/**
 * The status of an enquiry as a labelled badge (spec 0009, AC-12): the label comes from
 * `enquiries.status`, the color only underlines it. Server and client components.
 */
export function EnquiryStatusBadge({ status }: { readonly status: string }) {
  const t = useTranslations("enquiries.status");
  if (!isEnquiryStatus(status)) return <Badge variant="outline">{status}</Badge>;
  return (
    <Badge variant={VARIANTS[status]} data-status={status}>
      {t(status)}
    </Badge>
  );
}
