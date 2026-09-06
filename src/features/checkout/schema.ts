import { z } from "zod";
import { PACKAGE_KEYS } from "@/features/marketing/packages";

/**
 * The checkout's boundary schemas (spec 0011, AC-11, AC-19): the billing address and the two
 * purchase actions. The same schemas type the checkout form, so the browser and the server apply
 * one rule. Pure, runs anywhere.
 */

/** The weights of the Swiss UID check digit, applied to the nine digits in order. */
const UID_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4] as const;

/**
 * Validates a Swiss UID (`CHE-123.456.789`, optionally suffixed ` MWST` or ` TVA` / ` IVA` for the
 * other official languages): the shape, then the official mod 11 check digit over the first eight
 * digits with the weights 5,4,3,2,7,6,5,4. The ninth digit is the check digit.
 *
 * A remainder of 10 makes the number invalid (no such check digit exists), which is why those
 * combinations are simply never issued. Pure.
 */
export function isValidSwissUid(value: string): boolean {
  const match = /^CHE-(\d{3})\.(\d{3})\.(\d{3})(?: (?:MWST|TVA|IVA))?$/.exec(value.trim());
  if (!match) return false;
  const digits = `${match[1]}${match[2]}${match[3]}`;
  const weighted = UID_WEIGHTS.reduce(
    (sum, weight, index) => sum + weight * Number(digits[index]),
    0,
  );
  const remainder = weighted % 11;
  const check = remainder === 0 ? 0 : 11 - remainder;
  // 10 is not a usable check digit, so such a number is never issued and never valid.
  if (check === 10) return false;
  return check === Number(digits[8]);
}

/**
 * The billing address frozen onto an order (AC-11). Every field is trimmed; the UID is optional
 * and, when present, must be a real Swiss UID. An empty string becomes null, so a client who
 * leaves the field alone stores no UID rather than an empty one.
 */
export const billingAddressSchema = z.object({
  billingName: z.string().trim().min(1, "billingNameRequired").max(200, "billingNameLong"),
  billingStreet: z.string().trim().min(1, "billingStreetRequired").max(200, "billingStreetLong"),
  billingPostcode: z
    .string()
    .trim()
    .min(1, "billingPostcodeRequired")
    .max(20, "billingPostcodeLong"),
  billingTown: z.string().trim().min(1, "billingTownRequired").max(100, "billingTownLong"),
  billingCountry: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "billingCountryInvalid")
    .default("CH"),
  billingUid: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || isValidSwissUid(value), "billingUidInvalid"),
});

export type BillingAddress = z.output<typeof billingAddressSchema>;

/**
 * The purchase input both actions take (AC-1, AC-8, AC-19): which package, which company of the
 * caller's organization, and the billing address. `retainer` is rejected here as well as in the
 * action, so an unpurchasable package never reaches an insert.
 */
export const checkoutSchema = billingAddressSchema.extend({
  packageKey: z.enum(PACKAGE_KEYS),
  companyId: z.uuid(),
});

export type CheckoutInput = z.output<typeof checkoutSchema>;

/** The order id an ops action or a read path takes. */
export const orderIdSchema = z.object({ orderId: z.uuid() });

/** Ops cancelling a pending order must say why; the reason lands on the order_events row. */
export const cancelOrderSchema = z.object({
  orderId: z.uuid(),
  reason: z.string().trim().min(1, "reasonRequired").max(500, "reasonLong"),
});

/** Ops retrying a render that exhausted its retries. */
export const retryInvoiceRenderSchema = z.object({ invoiceId: z.uuid() });

/**
 * The order's purchase language, the short code the database stores, which drives the Stripe
 * locale, the invoice PDF and the confirmation email.
 */
export const orderLocaleSchema = z.enum(["de", "en"]);
