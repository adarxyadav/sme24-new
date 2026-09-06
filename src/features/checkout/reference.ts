/**
 * The two references a purchase carries (spec 0011, Value sourcing). Pure: no I/O, no clock.
 *
 * - The order reference `SME24-<year>-<counter>` is what the client and ops quote to each other.
 * - The SCOR creditor reference `RF..` is what the payer's bank sends back with the money, so the
 *   payment can be matched to the invoice automatically. It is derived from the invoice number,
 *   not the order reference: the reference is printed on the invoice, so it must be stable for
 *   that document, and invoice numbers are unique and gapless where order references need not be.
 */

/** Formats the order reference from the year and the sequence counter. Pure. */
export function orderReference(year: number, counter: number): string {
  return `SME24-${year}-${String(counter).padStart(4, "0")}`;
}

/** Formats the invoice number from the year and the sequence counter. Pure. */
export function invoiceNumber(year: number, counter: number): string {
  return `${year}-${String(counter).padStart(4, "0")}`;
}

/**
 * Converts letters to digits the ISO 11649 / ISO 7064 way: A is 10 through Z is 35. Digits pass
 * through. Pure.
 */
function toDigits(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      // 'A' is 65; A becomes 10, B 11 and so on.
      if (code >= 65 && code <= 90) return String(code - 55);
      return character;
    })
    .join("");
}

/**
 * The mod 97 remainder of a decimal string too long for a JavaScript number, taken in chunks so
 * no intermediate value can lose precision. Pure.
 */
function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) {
    remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

/**
 * Derives the ISO 11649 SCOR creditor reference from an invoice number (spec 0011, AC-4).
 *
 * The invoice number's own characters minus its punctuation are the reference body (`2026-0001`
 * becomes `20260001`). ISO 11649 computes the two check digits over the body followed by `RF00`,
 * with letters converted to digits (`R` is 27, `F` is 15), taking `98 - (n mod 97)`. The result is
 * `RF` plus the two check digits plus the body.
 *
 * Throws on a body that is empty or longer than the 21 characters the standard allows, because a
 * reference that will not fit is a programming error, not a user input. Pure.
 */
export function scorReference(invoiceNumberValue: string): string {
  const body = invoiceNumberValue.replace(/[^0-9A-Z]/gi, "").toUpperCase();
  if (body.length === 0 || body.length > 21) {
    throw new Error(`cannot build a SCOR reference from ${invoiceNumberValue}`);
  }
  const check = 98 - mod97(toDigits(`${body}RF00`));
  return `RF${String(check).padStart(2, "0")}${body}`;
}

/**
 * True when a SCOR reference is well formed and its check digits verify, the same test a bank
 * applies. Pure.
 */
export function isValidScorReference(reference: string): boolean {
  const value = reference.replace(/\s+/g, "").toUpperCase();
  if (!/^RF\d{2}[0-9A-Z]{1,21}$/.test(value)) return false;
  // Rotate the first four characters to the end, then the whole string must be 1 mod 97.
  return mod97(toDigits(`${value.slice(4)}${value.slice(0, 4)}`)) === 1;
}
