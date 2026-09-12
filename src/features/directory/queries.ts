import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeCursor, encodeCursor } from "@/lib/supabase/cursor";
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

/** One unlocked contact as the unlocks page and the export render it: raw values, never masked. */
export type UnlockedRow = {
  readonly unlockId: string;
  readonly contactId: string;
  readonly companyName: string;
  readonly companyCountry: string | null;
  readonly companyCity: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly country: string | null;
  readonly city: string | null;
  readonly email: string;
  readonly phone: string | null;
  readonly mobile: string | null;
  readonly unlockedAt: string;
};

type UnlockedRpcRow =
  Database["public"]["Functions"]["directory_unlocked_contacts"]["Returns"][number];

function toUnlockedRow(row: UnlockedRpcRow): UnlockedRow {
  return {
    unlockId: row.unlock_id,
    contactId: row.id,
    companyName: row.company_name,
    companyCountry: row.company_country ?? null,
    companyCity: row.company_city ?? null,
    firstName: row.first_name ?? null,
    lastName: row.last_name ?? null,
    title: row.contact_title ?? null,
    country: row.contact_country ?? null,
    city: row.contact_city ?? null,
    email: row.email,
    phone: row.phone ?? null,
    mobile: row.mobile ?? null,
    unlockedAt: row.unlocked_at,
  };
}

/** The keyset of the unlocks list: the last row's unlock moment and unlock id. */
export type UnlocksKeyset = { readonly createdAt: string; readonly id: string };

/**
 * One page of the caller's unlocked contacts, newest first, after `after` (AC-13). `size` is
 * clamped by the function (25 for the page, 500 for the export). Throws. Server component or
 * route handler.
 */
export async function unlockedContactsPage(
  supabase: Client,
  after: UnlocksKeyset | null,
  size: number,
): Promise<{ readonly rows: readonly UnlockedRow[] }> {
  const { data, error } = await supabase.rpc("directory_unlocked_contacts", {
    ...(after ? { after_created_at: after.createdAt, after_id: after.id } : {}),
    page_size: size,
  });
  if (error) throw queryError(error);
  return { rows: data.map(toUnlockedRow) };
}

export type UnlocksPage = {
  readonly rows: readonly UnlockedRow[];
  /** True on the first page (no cursor), so the empty state can offer the directory link. */
  readonly first: boolean;
  readonly nextCursor: string | null;
};

/**
 * The unlocks page (AC-13): 25 rows on the opaque `created_at|id` cursor the ops lists use; a
 * malformed cursor is the first page. Throws. Server component.
 */
export async function listUnlockedContacts(
  supabase: Client,
  cursor: string | null,
): Promise<UnlocksPage> {
  const after = decodeCursor(cursor ?? undefined);
  const { rows } = await unlockedContactsPage(supabase, after, DIRECTORY_PAGE_SIZE);
  const last = rows.at(-1);
  return {
    rows,
    first: after === null,
    nextCursor:
      rows.length === DIRECTORY_PAGE_SIZE && last
        ? encodeCursor({ createdAt: last.unlockedAt, id: last.unlockId })
        : null,
  };
}

/** One row of the ops table on /admin/directory: an expert with a balance or an unlock (AC-15). */
export type DirectoryOpsRow = {
  readonly expertId: string;
  readonly fullName: string | null;
  readonly email: string;
  readonly balance: number;
  readonly creditsBought: number;
  readonly unlocks: number;
  readonly lastUnlockAt: string | null;
};

/** The experts with credits or unlocks, from `directory_ops_summary()`. Throws. Server component, ops only. */
export async function getDirectoryOpsSummary(
  supabase: Client,
): Promise<readonly DirectoryOpsRow[]> {
  const { data, error } = await supabase.rpc("directory_ops_summary");
  if (error) throw queryError(error);
  return data.map((row) => ({
    expertId: row.expert_id,
    fullName: row.full_name ?? null,
    email: row.email,
    balance: row.balance,
    creditsBought: row.credits_bought,
    unlocks: Number(row.unlocks),
    lastUnlockAt: row.last_unlock_at ?? null,
  }));
}

export type DirectoryImportRow = Database["public"]["Tables"]["directory_imports"]["Row"];

/** The latest import run, or null before the first one. Throws. Server component, ops only. */
export async function getLatestImport(supabase: Client): Promise<DirectoryImportRow | null> {
  const { data, error } = await supabase
    .from("directory_imports")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw queryError(error);
  return data;
}

export type DirectoryTotals = {
  readonly companies: number;
  readonly contacts: number;
  readonly suppressed: number;
};

/** The three counts under the ops policies. Throws. Server component, ops only. */
export async function getDirectoryTotals(supabase: Client): Promise<DirectoryTotals> {
  const [companies, contacts, suppressed] = await Promise.all([
    supabase.from("directory_companies").select("id", { count: "exact", head: true }),
    supabase.from("directory_contacts").select("id", { count: "exact", head: true }),
    supabase.from("directory_suppressions").select("email_hash", { count: "exact", head: true }),
  ]);
  for (const result of [companies, contacts, suppressed]) {
    if (result.error) throw queryError(result.error);
  }
  return {
    companies: companies.count ?? 0,
    contacts: contacts.count ?? 0,
    suppressed: suppressed.count ?? 0,
  };
}
