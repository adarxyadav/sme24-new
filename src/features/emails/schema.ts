import { z } from "zod";
import { DELIVERY_STATUSES, EMAIL_TEMPLATE_NAMES } from "@/lib/email/schema";

/** The `/admin/emails` query parameters (spec 0006, AC-9): an invalid value falls back to no filter. */
export const deliveryFiltersSchema = z.object({
  status: z.enum(DELIVERY_STATUSES).optional().catch(undefined),
  template: z.enum(EMAIL_TEMPLATE_NAMES).optional().catch(undefined),
  q: z.string().trim().max(320).optional().catch(undefined),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type DeliveryFilters = z.infer<typeof deliveryFiltersSchema>;

/** The retry action input. */
export const retryDeliverySchema = z.object({ deliveryId: z.uuid() });

/** Rows per page of the ops list. */
export const PAGE_SIZE = 50;

/** Builds the query string of the list page from filters plus a cursor, dropping empty values. Pure. */
export function deliveryListQuery(
  filters: Omit<DeliveryFilters, "cursor">,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.template) params.set("template", filters.template);
  if (filters.q) params.set("q", filters.q);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}
