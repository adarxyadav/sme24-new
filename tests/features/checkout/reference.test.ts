import { describe, expect, it } from "vitest";
import {
  invoiceNumber,
  isValidScorReference,
  orderReference,
  scorReference,
} from "@/features/checkout/reference";

describe("orderReference and invoiceNumber (spec 0011)", () => {
  it("zero pads the counter to four digits and keeps the shape the constraint requires", () => {
    expect(orderReference(2026, 1)).toBe("SME24-2026-0001");
    expect(orderReference(2026, 42)).toBe("SME24-2026-0042");
    expect(invoiceNumber(2026, 1)).toBe("2026-0001");
    expect(invoiceNumber(2026, 9999)).toBe("2026-9999");
  });

  it("keeps growing past four digits rather than truncating", () => {
    expect(orderReference(2026, 12345)).toBe("SME24-2026-12345");
    expect(invoiceNumber(2026, 12345)).toBe("2026-12345");
  });

  it("matches the database check constraints", () => {
    // 41_orders.sql: '^SME24-[0-9]{4}-[0-9]{4,}$'; 43_invoices.sql: '^[0-9]{4}-[0-9]{4,}$'.
    expect(orderReference(2026, 1)).toMatch(/^SME24-\d{4}-\d{4,}$/);
    expect(orderReference(2026, 123456)).toMatch(/^SME24-\d{4}-\d{4,}$/);
    expect(invoiceNumber(2026, 1)).toMatch(/^\d{4}-\d{4,}$/);
  });
});

describe("scorReference (spec 0011 AC-4, ISO 11649)", () => {
  it("reproduces the reference published in the standard", () => {
    // RF18539007547034 is the worked example of ISO 11649.
    expect(scorReference("539007547034")).toBe("RF18539007547034");
  });

  it("accepts the published examples as valid", () => {
    expect(isValidScorReference("RF18539007547034")).toBe(true);
    expect(isValidScorReference("RF18000000000539007547034")).toBe(true);
  });

  it("derives a valid reference from an invoice number, dropping the punctuation", () => {
    for (const number of ["2026-0001", "2026-0042", "2026-9999", "2027-0001", "2026-12345"]) {
      const reference = scorReference(number);
      expect(reference.startsWith("RF")).toBe(true);
      expect(isValidScorReference(reference)).toBe(true);
      // The body is the invoice number without its hyphen, so the document and the payment match.
      expect(reference.slice(4)).toBe(number.replace("-", ""));
    }
  });

  it("matches the database check constraint on qr_reference", () => {
    // 43_invoices.sql: '^RF[0-9]{2}[0-9A-Z]{1,21}$'.
    expect(scorReference("2026-0001")).toMatch(/^RF\d{2}[0-9A-Z]{1,21}$/);
  });

  it("gives a different reference to every invoice number", () => {
    const references = new Set(
      Array.from({ length: 200 }, (_, index) => scorReference(invoiceNumber(2026, index + 1))),
    );
    expect(references.size).toBe(200);
  });

  it("refuses a body that is empty or too long for the standard", () => {
    expect(() => scorReference("")).toThrow();
    expect(() => scorReference("----")).toThrow();
    expect(() => scorReference("1".repeat(22))).toThrow();
  });
});

describe("isValidScorReference", () => {
  it("rejects a wrong check digit", () => {
    expect(isValidScorReference("RF19539007547034")).toBe(false);
    expect(isValidScorReference("RF3220260001")).toBe(false);
  });

  it("rejects a malformed reference", () => {
    expect(isValidScorReference("")).toBe(false);
    expect(isValidScorReference("539007547034")).toBe(false);
    expect(isValidScorReference("RF1")).toBe(false);
    expect(isValidScorReference("QR18539007547034")).toBe(false);
    expect(isValidScorReference(`RF18${"1".repeat(22)}`)).toBe(false);
  });

  it("ignores the spacing a bank statement may add", () => {
    expect(isValidScorReference("RF18 5390 0754 7034")).toBe(true);
  });
});
