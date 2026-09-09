import { z } from "zod";

/**
 * The data request boundary schemas and the transition rules (spec 0015, AC-11, AC-14). There is
 * no database trigger for the workflow, unlike orders in spec 0014 where money made one worth it,
 * so the adjacency list below is the source of truth and is a literal rather than prose a builder
 * has to re read. Pure data and pure functions; runs anywhere.
 */

/** The two rights a subject can exercise in the app. */
export const DATA_REQUEST_KINDS = ["export", "deletion"] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

/** The four statuses, in workflow order; the first two are the open queue. */
export const DATA_REQUEST_STATUSES = ["new", "in_progress", "fulfilled", "refused"] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

/** The statuses that count as open: the partial unique index names exactly these two. */
export const OPEN_STATUSES = ["new", "in_progress"] as const satisfies readonly DataRequestStatus[];

/**
 * Every legal move, and the whole of it (AC-14). `fulfilled` and `refused` have no exits on
 * purpose: reopening a terminal request would make the row a record of two different asks, so the
 * answer to wanting more is a new request.
 */
export const DATA_REQUEST_TRANSITIONS = {
  new: ["in_progress", "refused"],
  in_progress: ["fulfilled", "refused"],
  fulfilled: [],
  refused: [],
} as const satisfies Record<DataRequestStatus, readonly DataRequestStatus[]>;

/** Whether a move is one the adjacency list allows. Pure. */
export function canTransition(from: DataRequestStatus, to: DataRequestStatus): boolean {
  return (DATA_REQUEST_TRANSITIONS[from] as readonly DataRequestStatus[]).includes(to);
}

/** Whether a status is still open, and so blocks a second request of the same kind. Pure. */
export function isOpen(status: DataRequestStatus): boolean {
  return (OPEN_STATUSES as readonly DataRequestStatus[]).includes(status);
}

/**
 * Whether the ops note satisfies the refusal rule (AC-14): a refusal requires a non empty note, so
 * no request is ever refused without a reason on the record. Every other move may carry one or
 * not. Checked here rather than by a constraint, because the rule is about the move rather than
 * about the row: a request refused with a note and later re read must stay valid. Pure.
 */
export function refusalNoteMissing(status: DataRequestStatus, note: string | null): boolean {
  return status === "refused" && !note;
}

/**
 * The alert kind fired when a request is filed (AC-13). A constant rather than a string literal at
 * the call site, the same shape `ENQUIRY_RECEIVED_EVENT` uses, so the kind and its presenter in
 * `src/lib/alerts/` are found together.
 */
export const DATA_REQUEST_RECEIVED_EVENT = "data_request.received" as const;

/** The days ops have to answer, the Art. 25 window that `due_at` carries. */
export const ANSWER_WINDOW_DAYS = 30;

/** The client card's form: which right the caller is exercising, and nothing else. */
export const requestDataSchema = z.object({
  kind: z.enum(DATA_REQUEST_KINDS),
  locale: z.string().optional(),
});
export type RequestDataInput = z.input<typeof requestDataSchema>;

/**
 * The ops workflow form on the detail page. The note is trimmed and empty becomes null, so a field
 * holding only spaces cannot pass the refusal rule; `refusalNoteMissing` then reads the stored
 * shape rather than the typed one.
 */
export const updateDataRequestSchema = z.object({
  id: z.uuid(),
  status: z.enum(DATA_REQUEST_STATUSES),
  opsNote: z
    .string()
    .trim()
    .max(2000, "noteLong")
    .nullish()
    .transform((value) => (value ? value : null)),
  locale: z.string().optional(),
});
export type UpdateDataRequestInput = z.input<typeof updateDataRequestSchema>;
export type UpdateDataRequestValues = z.output<typeof updateDataRequestSchema>;

/** The select value that means every status on the ops list. */
export const ALL_DATA_REQUEST_STATUSES = "all";

/**
 * The `/admin/data-requests` query parameters. The default is the open queue rather than a single
 * status, because the thing ops must not miss is a deadline, and a deadline belongs to a request
 * that is still open in either of its two ways.
 */
export const dataRequestFiltersSchema = z.object({
  status: z.enum([...DATA_REQUEST_STATUSES, ALL_DATA_REQUEST_STATUSES, "open"]).catch("open"),
  cursor: z.string().max(200).optional().catch(undefined),
});
export type DataRequestFilters = z.infer<typeof dataRequestFiltersSchema>;

/** Rows per page of the ops list. */
export const PAGE_SIZE = 50;

/** Builds the query string of the ops list from filters plus a cursor, dropping the defaults. Pure. */
export function dataRequestListQuery(
  filters: Omit<DataRequestFilters, "cursor">,
  cursor?: string | null,
): string {
  const params = new URLSearchParams();
  if (filters.status !== "open") params.set("status", filters.status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * The due date of a request filed at `from`: thirty days on, in UTC, matching `purge-enquiries`'
 * own arithmetic. Only the overdue comparison converts to Europe/Zurich. Pure.
 */
export function dueAtFrom(from: Date): Date {
  return new Date(from.getTime() + ANSWER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}
