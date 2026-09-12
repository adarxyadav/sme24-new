import { z } from "zod";
import { billingAddressSchema } from "@/features/checkout/schema";
import { CREDIT_PACK_KEYS } from "./catalogue";
import { isCountryCode } from "./countries";

/**
 * The directory's boundary schemas (spec 0018, AC-4, AC-5): the search params of
 * `/expert/directory` and the opaque keyset cursor. Every form and action parses with these;
 * the same types drive the page.
 */

/**
 * A search text: trimmed, an empty string means absent, one character is refused (`tooShort`)
 * so the function's own 2 to 100 rule is never reached with a one character value.
 */
const searchText = z
  .string()
  .trim()
  .max(100, "tooLong")
  .optional()
  .transform((value) => (value === undefined || value.length === 0 ? undefined : value))
  .refine((value) => value === undefined || value.length >= 2, { message: "tooShort" });

/** A country filter: an alpha 2 code, anything else (the "all" option, a stray value) means none. */
const countryFilter = z
  .string()
  .optional()
  .transform((value) => (value !== undefined && isCountryCode(value) ? value : undefined));

/** The `/expert/directory` search params: the three optional filters and the opaque cursor. */
export const directorySearchSchema = z.object({
  q: searchText,
  title: searchText,
  country: countryFilter,
  after: z.string().max(600).optional(),
});
export type DirectorySearch = z.infer<typeof directorySearchSchema>;

/** The value the "all countries" option submits; the schema reads it as no filter. */
export const ALL_COUNTRIES = "all";

/**
 * The keyset cursor of a search page: the last row's company name (normalised) and contact id,
 * plus the ordinal of the page the cursor points to. It travels as one base64url value in the
 * `after` search param, never as three params the caller could reset; the function refuses a
 * page past the cap with SM429, and the page renders that as a message rather than a 404.
 */
const cursorSchema = z.object({
  n: z.string().min(1).max(300),
  i: z.uuid(),
  p: z.number().int().min(2).max(10_000),
});

export type SearchCursor = {
  readonly name: string;
  readonly id: string;
  /** The ordinal of the page this cursor leads to; the first page has no cursor and is page 1. */
  readonly page: number;
};

/** Encodes a search cursor as base64url. Server only (Buffer). */
export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(
    JSON.stringify({ n: cursor.name, i: cursor.id, p: cursor.page }),
    "utf8",
  ).toString("base64url");
}

/** Decodes a search cursor; a malformed value is null, which the page answers with 404. Server only. */
export function decodeSearchCursor(value: string | undefined): SearchCursor | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success) return null;
  return { name: result.data.n, id: result.data.i, page: result.data.p };
}

/**
 * The query object of a search link: the three filters when set, plus a cursor when given.
 * Pure, shared by the "Load more" link and the reset link.
 */
export function searchQuery(
  params: Pick<DirectorySearch, "q" | "title" | "country">,
  after?: string | null,
): Record<string, string> {
  return {
    ...(params.q ? { q: params.q } : {}),
    ...(params.title ? { title: params.title } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(after ? { after } : {}),
  };
}

/** The revealContact action input (AC-12). */
export const revealContactSchema = z.object({
  contactId: z.uuid(),
  locale: z.enum(["de", "en"]),
});
export type RevealContactInput = z.infer<typeof revealContactSchema>;

/**
 * The credit pack purchase (AC-9): which pack, the billing address and the payment method, in the
 * buyer's language. The billing country is not a field: every expert buyer is established in
 * Switzerland (owner decision, 2026-09-12), so the rail's 8.1 percent MWST is always right and a
 * foreign address cannot enter; the action writes the literal `CH`. `packKey` is the credit pack
 * list, never `PACKAGE_KEYS`, so an assessment package can never reach this action.
 */
export const creditCheckoutSchema = billingAddressSchema.omit({ billingCountry: true }).extend({
  packKey: z.enum(CREDIT_PACK_KEYS),
  paymentMethod: z.enum(["card", "bank_transfer"]),
});
export type CreditCheckoutInput = z.output<typeof creditCheckoutSchema>;

/** The billing country of every credit pack order, by owner decision. */
export const CREDIT_BILLING_COUNTRY = "CH";
