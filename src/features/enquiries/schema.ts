import { z } from "zod";

/**
 * The ops side of the enquiries (spec 0009, AC-12): the list filters and the workflow update.
 * Pure, runs anywhere.
 */

/** The three statuses, in the order the ops filter lists them. Any status may follow any other. */
export const ENQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** The select value that means every status. */
export const ALL_STATUSES = "all";

/** The `/admin/enquiries` query parameters: the status filter (default `new`) and the cursor. */
export const enquiryFiltersSchema = z.object({
  status: z.enum([...ENQUIRY_STATUSES, ALL_STATUSES]).catch("new"),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type EnquiryFilters = z.infer<typeof enquiryFiltersSchema>;

/** Rows per page of the ops list. */
export const PAGE_SIZE = 50;

/** The workflow form on the detail page: the status and the ops note. */
export const updateEnquirySchema = z.object({
  id: z.uuid(),
  status: z.enum(ENQUIRY_STATUSES),
  opsNote: z
    .string()
    .trim()
    .max(2000, "noteLong")
    .nullish()
    .transform((value) => (value ? value : null)),
  locale: z.string().optional(),
});
export type UpdateEnquiryInput = z.input<typeof updateEnquirySchema>;
export type UpdateEnquiryValues = z.output<typeof updateEnquirySchema>;

/**
 * The `handled_at` rule (AC-12): `handled_by` and `handled_at` are written the first time the
 * status leaves `new`, so only a target status other than `new` can set them; the stored status
 * decides in the statement itself. Pure.
 */
export function leavesNew(status: EnquiryStatus): boolean {
  return status !== "new";
}

/** Builds the query string of the list page from filters plus a cursor, dropping the defaults. Pure. */
export function enquiryListQuery(
  filters: Omit<EnquiryFilters, "cursor">,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.status !== "new") params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}
