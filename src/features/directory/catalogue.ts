/**
 * The contact directory's constants (spec 0018): the credit packs and the unit price the unlock
 * button shows, the page sizes, and the twelve workbook columns the import maps by header name.
 * `CREDIT_PACK_KEYS` stays separate from `PACKAGE_KEYS` in `src/features/marketing/packages.ts`
 * on purpose, so a credit pack never types the pricing page or `checkoutSchema`; the `packages`
 * table's key check holds the union of the two lists, and a Vitest test keeps `CREDIT_PACKS`
 * equal to the credit pack seed migration. Alias free, Node only: the import script reads it
 * under type stripping. Pure data.
 */

export const CREDIT_PACK_KEYS = ["directory_50"] as const;
export type CreditPackKey = (typeof CREDIT_PACK_KEYS)[number];

/** The net price of one credit in Rappen, CHF 1.99 (owner decision, 2026-09-12: net, like every price on the site). */
export const CREDIT_PRICE_RAPPEN = 199;

export type CreditPack = {
  readonly key: CreditPackKey;
  readonly credits: number;
  /** Net price in whole Rappen: credits times CREDIT_PRICE_RAPPEN. */
  readonly priceRappen: number;
  readonly sortOrder: number;
};

export const CREDIT_PACKS: readonly CreditPack[] = [
  { key: "directory_50", credits: 50, priceRappen: 50 * CREDIT_PRICE_RAPPEN, sortOrder: 10 },
] as const;

/** Rows per search page and per unlocks page (AC-4, AC-13). */
export const DIRECTORY_PAGE_SIZE = 25;
/** The deepest page a search cursor may name (AC-4): 40 pages of 25 is 1,000 rows. */
export const DIRECTORY_MAX_PAGE = 40;
/** Rows per page the CSV export streams (AC-13). */
export const DIRECTORY_EXPORT_PAGE_SIZE = 500;

/**
 * The twelve columns of the purchased workbook's `Contacts` sheet, by header name (AC-2). The
 * import refuses a workbook missing any of them, so a re exported file with a renamed column
 * fails loudly instead of loading blanks.
 */
export const IMPORT_COLUMNS = {
  company: "Company",
  firstName: "First Name",
  lastName: "Last Name",
  title: "Title",
  email: "Email",
  phone: "Phone",
  mobile: "Mobile",
  street: "Street",
  city: "City",
  state: "State / Province",
  postalCode: "Postal Code",
  country: "Country",
} as const;

export type ImportColumn = keyof typeof IMPORT_COLUMNS;

/** The sheet names the import reads: the rows, and the summary whose Source cell names the batch. */
export const IMPORT_SHEETS = { contacts: "Contacts", summary: "Summary" } as const;
