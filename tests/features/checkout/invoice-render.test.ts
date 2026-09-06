// @vitest-environment node
import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import { getReferenceType } from "swissqrbill/utils";
import { describe, expect, it } from "vitest";
import { splitSellerAddress, splitStreet } from "@/features/checkout/invoice-document";
import { rappenToChf } from "@/features/checkout/money";
import { scorReference } from "@/features/checkout/reference";
import { createFormatterFor, createTranslatorFor } from "@/i18n/standalone";

/**
 * The invoice PDF (spec 0011, AC-4). These exercise the drawing path the `render-invoice` task
 * runs: the QR bill accepts our SCOR reference, the document renders to real PDF bytes in both
 * languages, and every amount comes out of the frozen Rappen through the `chf` format.
 */

const SELLER = {
  name: "IC Hotz GmbH",
  address: "Obermühle 5, 6340 Baar",
  uid: "CHE-101.654.423 MWST",
  iban: "CH9300762011623852957",
};
const BUYER = {
  name: "Musterfirma AG",
  street: "Bahnhofstrasse 1",
  postcode: "8001",
  town: "Zürich",
  country: "CH",
};

/** Draws the same shape the task draws and returns the bytes. */
async function render(locale: "de-CH" | "en-CH", grossRappen: number, invoiceNumber: string) {
  const t = await createTranslatorFor(locale);
  const format = createFormatterFor(locale);
  const qrReference = scorReference(invoiceNumber);
  const pdf = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => pdf.on("end", () => resolve()));

  pdf.fontSize(18).text(t("invoice.title"), 50, 260);
  pdf.fontSize(10).text(`${t("invoice.number")}: ${invoiceNumber}`);
  pdf.text(`${t("invoice.gross")}: ${format.number(rappenToChf(grossRappen), "chf")}`);

  const sellerAddress = splitSellerAddress(SELLER.address);
  const buyerStreet = splitStreet(BUYER.street);
  const bill = new SwissQRBill({
    amount: rappenToChf(grossRappen),
    currency: "CHF",
    reference: qrReference,
    creditor: {
      account: SELLER.iban,
      name: SELLER.name,
      address: sellerAddress.street,
      buildingNumber: sellerAddress.buildingNumber,
      zip: sellerAddress.postcode,
      city: sellerAddress.town,
      country: "CH",
    },
    debtor: {
      name: BUYER.name,
      address: buyerStreet.street,
      buildingNumber: buyerStreet.buildingNumber,
      zip: BUYER.postcode,
      city: BUYER.town,
      country: BUYER.country,
    },
  });
  bill.attachTo(pdf);
  pdf.end();
  await finished;
  return Buffer.concat(chunks);
}

describe("the invoice QR bill (spec 0011 AC-4)", () => {
  it("is recognised as a SCOR reference by the QR bill library", () => {
    // Our own generator and the library must agree, or the bill would carry an unusable reference.
    expect(getReferenceType(scorReference("2026-0001"))).toBe("SCOR");
    expect(getReferenceType(scorReference("2026-9999"))).toBe("SCOR");
    expect(getReferenceType(scorReference("2027-0042"))).toBe("SCOR");
  });

  it("renders a real PDF in German", async () => {
    const pdf = await render("de-CH", 216_200, "2026-0001");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it("renders a real PDF in English", async () => {
    const pdf = await render("en-CH", 540_500, "2026-0002");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
  });

  it("refuses an IBAN that is not a real account, so a placeholder cannot reach a bill", () => {
    expect(
      () =>
        new SwissQRBill({
          amount: 100,
          currency: "CHF",
          reference: scorReference("2026-0001"),
          creditor: {
            account: "CH0000000000000000000",
            name: "X",
            address: "A",
            zip: "6340",
            city: "Baar",
            country: "CH",
          },
          debtor: { name: "Y", address: "B", zip: "8001", city: "Zürich", country: "CH" },
        }),
    ).toThrow();
  });
});
