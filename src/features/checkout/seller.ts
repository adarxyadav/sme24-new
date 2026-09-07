import "server-only";
import { serverEnv } from "@/lib/env";
import { SELLER_PLACEHOLDERS, type Seller } from "./seller-facts";

/**
 * Reads the seller facts an invoice is issued with (spec 0011, AC-17). They are frozen onto the
 * `invoices` row at issue, so changing the configuration never rewrites a document already sent:
 * this module supplies them only at the moment an invoice is created.
 *
 * They come from environment variables rather than a constant because the UID and the IBAN are
 * per environment: staging must never print the production IBAN on a test invoice, and a QR bill
 * carrying the wrong account is a real money problem, not a cosmetic one.
 *
 * The shape and the placeholder guard live in `seller-facts.ts`, which is pure.
 * Server only (an action or a task); never imported by browser code.
 */

/**
 * The seller facts for an invoice being issued, falling back to the placeholders for any value
 * the environment does not set, so local development and previews still render a complete
 * document. Server only.
 */
export function seller(): Seller {
  const env = serverEnv();
  return {
    name: env.SELLER_NAME || SELLER_PLACEHOLDERS.name,
    address: env.SELLER_ADDRESS || SELLER_PLACEHOLDERS.address,
    uid: env.SELLER_UID || SELLER_PLACEHOLDERS.uid,
    iban: env.SELLER_IBAN || SELLER_PLACEHOLDERS.iban,
  };
}

/** Days from issue to the due date on the bank transfer path (spec 0011). Server only. */
export function invoiceDueDays(): number {
  return serverEnv().INVOICE_DUE_DAYS;
}
