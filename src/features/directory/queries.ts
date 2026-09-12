import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { DIRECTORY_PAGE_SIZE } from "./catalogue";
import type { CountryCode } from "./countries";
import { type DirectorySearch, encodeSearchCursor, type SearchCursor } from "./schema";

/**
 * The reads of the contact directory (spec 0018). Every one goes through a definer function on
 * the caller's own client, because the directory tables carry no select policy for an expert:
 * the function checks the role and the status and masks what the caller has not paid for
 * (invariant 1). Queries throw on a database error, per the project's one error handling rule.
 */

type Client = SupabaseClient<Database>;

/** One search result as the page renders it: masked always, raw only when `unlocked` (or ops). */
export type DirectoryRow = {
  readonly contactId: string;
  readonly companyId: string;
  readonly companyName: string;
  readonly companyNameNormalised: string;
  readonly companyCountry: string | null;
  readonly companyCity: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly country: string | null;
  readonly city: string | null;
  readonly emailMasked: string;
  readonly phoneMasked: string | null;
  readonly mobileMasked: string | null;
  readonly unlocked: boolean;
  readonly email: string | null;
  readonly phone: string | null;
  readonly mobile: string | null;
};

export type DirectoryPage = {
  readonly rows: readonly DirectoryRow[];
  /** The ordinal of this page, 1 without a cursor. */
  readonly page: number;
  /** The cursor of the next page, null when this page came back short. */
  readonly nextCursor: string | null;
};

type SearchRpcRow = Database["public"]["Functions"]["directory_search"]["Returns"][number];

/** The generated type reads every `returns table` column as non null; the raw three are not. */
function toRow(row: SearchRpcRow): DirectoryRow {
  return {
    contactId: row.contact_id,
    companyId: row.company_id,
    companyName: row.company_name,
    companyNameNormalised: row.company_name_normalised,
    companyCountry: row.company_country ?? null,
    companyCity: row.company_city ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    title: row.contact_title ?? null,
    country: row.contact_country ?? null,
    city: row.contact_city ?? null,
    emailMasked: row.email_masked,
    phoneMasked: row.phone_masked ?? null,
    mobileMasked: row.mobile_masked ?? null,
    unlocked: row.unlocked,
    email: row.email ?? null,
    phone: row.phone ?? null,
    mobile: row.mobile ?? null,
  };
}

/**
 * One masked page of the directory (AC-4): 25 rows in keyset order after `cursor`. The next
 * cursor is minted from the last row whenever the page is full; the function clamps the page
 * size, so a full page cannot be told from "exactly 25 left" and the following page may come
 * back empty, which the page renders as its end. Throws. Server component.
 */
export async function searchDirectory(
  supabase: Client,
  params: Pick<DirectorySearch, "q" | "title" | "country">,
  cursor: SearchCursor | null,
): Promise<DirectoryPage> {
  const { data, error } = await supabase.rpc("directory_search", {
    ...(params.q ? { q: params.q } : {}),
    ...(params.title ? { title: params.title } : {}),
    ...(params.country ? { country: params.country } : {}),
    ...(cursor ? { after_name: cursor.name, after_id: cursor.id, after_page: cursor.page } : {}),
    page_size: DIRECTORY_PAGE_SIZE,
  });
  if (error) throw queryError(error);
  const rows = data.map(toRow);
  const page = cursor?.page ?? 1;
  const last = rows[rows.length - 1];
  const nextCursor =
    rows.length === DIRECTORY_PAGE_SIZE && last
      ? encodeSearchCursor({ name: last.companyNameNormalised, id: last.contactId, page: page + 1 })
      : null;
  return { rows, page, nextCursor };
}

export type DirectoryCountry = { readonly code: CountryCode; readonly contacts: number };

/** The alpha 2 codes present in the directory with a contact count each (AC-5). Throws. Server component. */
export async function listDirectoryCountries(
  supabase: Client,
): Promise<readonly DirectoryCountry[]> {
  const { data, error } = await supabase.rpc("directory_countries");
  if (error) throw queryError(error);
  return data.map((row) => ({ code: row.country as CountryCode, contacts: Number(row.contacts) }));
}

/** The caller's credit balance, sum(delta) over their ledger (AC-5). Throws. Server component. */
export async function getCreditBalance(supabase: Client): Promise<number> {
  const { data, error } = await supabase.rpc("directory_credit_balance");
  if (error) throw queryError(error);
  return data ?? 0;
}
