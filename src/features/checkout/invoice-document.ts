import type { Seller } from "./seller-facts";

/**
 * The data an invoice PDF prints (spec 0011, AC-4). Every value comes from the frozen `invoices`
 * and `orders` columns, never from `packages`: an invoice shows what was agreed at purchase, not
 * what the package costs today.
 *
 * Pure data plus the pure address split below, so the renderer stays a thin drawing layer and the
 * parsing has its own tests.
 */

export type InvoiceDocument = {
  readonly invoiceNumber: string;
  readonly issuedAt: Date;
  readonly dueDate: Date;
  readonly reference: string;
  readonly qrReference: string;
  readonly seller: Seller;
  readonly buyer: {
    readonly name: string;
    readonly street: string;
    readonly postcode: string;
    readonly town: string;
    readonly country: string;
    readonly uid: string | null;
  };
  readonly lineDescription: string;
  readonly netRappen: number;
  readonly vatRate: number;
  readonly vatRappen: number;
  readonly grossRappen: number;
  readonly locale: "de" | "en";
};

/** A street split into its name and building number, the shape the QR bill wants. */
export type SplitStreet = {
  readonly street: string;
  readonly buildingNumber: string | undefined;
};

/**
 * Splits `Bahnhofstrasse 1` into the street and its building number, which the Swiss QR bill
 * carries as separate fields. A street with no trailing number keeps the whole string and reports
 * no number, which the bill allows. Pure.
 */
export function splitStreet(value: string): SplitStreet {
  const match = /^(.*?)[\s,]+([0-9][0-9a-zA-Z\-/.]*)$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return { street: value.trim(), buildingNumber: undefined };
  return { street: match[1].trim(), buildingNumber: match[2] };
}

/**
 * The seller's address split into the parts the QR bill needs. The configured address is one
 * line (`Obermühle 5, 6340 Baar`), so it is parsed here rather than stored in four columns; a
 * line that does not parse falls back to putting everything in the street, which still produces a
 * valid bill. Pure.
 */
export function splitSellerAddress(address: string): {
  readonly street: string;
  readonly buildingNumber: string | undefined;
  readonly postcode: string;
  readonly town: string;
} {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const zipTown = last ? /^(\d{4,5})\s+(.+)$/.exec(last) : null;
  if (!zipTown?.[1] || !zipTown[2]) {
    return { ...splitStreet(address), postcode: "", town: "" };
  }
  return {
    ...splitStreet(parts.slice(0, -1).join(", ")),
    postcode: zipTown[1],
    town: zipTown[2],
  };
}
