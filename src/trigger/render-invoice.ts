import "./instrumentation";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger, schemaTask } from "@trigger.dev/sdk";
import PDFDocument from "pdfkit";
import { SwissQRBill } from "swissqrbill/pdf";
import { z } from "zod";
import {
  type InvoiceDocument,
  splitSellerAddress,
  splitStreet,
} from "@/features/checkout/invoice-document";
import { rappenToChf } from "@/features/checkout/money";
import { SELLER_PLACEHOLDERS } from "@/features/checkout/seller-facts";
import { createFormatterFor, createTranslatorFor } from "@/i18n/standalone";
import { taskEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import type { Database } from "@/lib/supabase/database.types";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { raiseAlertFromTask } from "./ops-alert";

/**
 * The invoice PDF (spec 0011, AC-4, AC-10). Draws the document from the frozen `invoices` and
 * `orders` columns, attaches the Swiss QR bill with its SCOR creditor reference, and uploads it
 * to the private `invoices` bucket. The task never re reads `packages`: an invoice shows what was
 * agreed at purchase.
 *
 * On exhausting its retries it sets `pdf_failed_at` and raises an ops alert, so the order stays
 * `paid` and the client keeps their purchase (AC-10). A failing render never unwinds a payment.
 */

type Service = SupabaseClient<Database>;

export const renderInvoicePayloadSchema = z.object({ invoiceId: z.uuid() });
export type RenderInvoicePayload = z.infer<typeof renderInvoicePayloadSchema>;

/** The A4 page and its margin in points, the units PDFKit works in. */
const MARGIN = 50;

export const renderInvoiceTask = schemaTask({
  id: "render-invoice",
  schema: renderInvoicePayloadSchema,
  retry: { maxAttempts: 3 },
  onFailure: async ({ payload, error }) => {
    // Retries are exhausted: record it so ops can retry by hand and the client sees an honest
    // message, then let the confirmation email go out without the attachment.
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);
    await supabase
      .from("invoices")
      .update({ pdf_failed_at: new Date().toISOString() })
      .eq("id", payload.invoiceId);
    // The alert names the invoice and the order, which is what ops work with; the ids alone
    // would send them hunting.
    const { data: row } = await supabase
      .from("invoices")
      .select("number, orders!inner(reference), organizations:organization_id(name)")
      .eq("id", payload.invoiceId)
      .maybeSingle();
    const order = row?.orders as { reference?: string } | undefined;
    const organization = row?.organizations as { name?: string } | undefined;
    await raiseAlertFromTask({
      kind: "invoice.render_failed",
      idempotencyKey: `invoice-render-failed/${payload.invoiceId}`,
      fields: {
        invoiceNumber: row?.number ?? payload.invoiceId,
        reference: order?.reference ?? payload.invoiceId,
        organizationName: organization?.name ?? "Unknown organization",
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      },
    });
    logger.error("invoice render exhausted its retries", { invoiceId: payload.invoiceId });
  },
  run: async ({ invoiceId }: RenderInvoicePayload) => {
    const env = taskEnv();
    const supabase = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

    const document = await loadDocument(supabase, invoiceId);
    if (!document) {
      logger.error("render invoice: no such invoice", { invoiceId });
      return { rendered: false as const, reason: "not_found" as const };
    }

    // A placeholder IBAN would make the QR bill throw anyway (the library validates the account),
    // but failing here says why in one line instead of a checksum error five frames down.
    if (sellerIsPlaceholder(document.seller.iban)) {
      throw new Error(
        "the seller IBAN is still the placeholder: set SELLER_IBAN before issuing invoices",
      );
    }

    const pdf = await drawInvoice(document);
    const path = `${document.organizationId}/${invoiceId}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (uploadError) throw new Error(`invoice upload failed: ${uploadError.message}`);

    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        pdf_path: path,
        pdf_rendered_at: new Date().toISOString(),
        // A successful retry clears the failure, so ops stop seeing it in their queue.
        pdf_failed_at: null,
      })
      .eq("id", invoiceId);
    if (updateError) throw queryError(updateError);

    log.info("invoice rendered", { invoiceId, path, bytes: pdf.length });
    return { rendered: true as const, path };
  },
});

/** The invoice with its order, joined into the shape the drawing needs. */
async function loadDocument(
  supabase: Service,
  invoiceId: string,
): Promise<(InvoiceDocument & { readonly organizationId: string }) | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("*, orders!inner(*)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw queryError(error);
  if (!data) return null;

  const order = data.orders as unknown as Database["public"]["Tables"]["orders"]["Row"];
  return {
    organizationId: data.organization_id,
    invoiceNumber: data.number,
    issuedAt: new Date(data.issued_at),
    dueDate: new Date(data.due_date),
    reference: order.reference,
    qrReference: data.qr_reference,
    seller: {
      name: data.seller_name,
      address: data.seller_address,
      uid: data.seller_uid,
      iban: data.seller_iban,
    },
    buyer: {
      name: order.billing_name,
      street: order.billing_street,
      postcode: order.billing_postcode,
      town: order.billing_town,
      country: order.billing_country,
      uid: order.billing_uid,
    },
    lineDescription: order.package_name_snapshot,
    netRappen: Number(order.net_rappen),
    vatRate: Number(order.vat_rate),
    vatRappen: Number(order.vat_rappen),
    grossRappen: Number(order.gross_rappen),
    locale: order.locale === "de" ? "de" : "en",
  };
}

/**
 * Draws the invoice and returns the PDF bytes. The layout is deliberately plain: a Swiss invoice
 * is a document a bookkeeper reads, not a brochure. Every amount comes from the frozen columns and
 * is divided by 100 only here, at the display boundary.
 */
async function drawInvoice(document: InvoiceDocument): Promise<Buffer> {
  const fullLocale = document.locale === "de" ? "de-CH" : "en-CH";
  const [t, format] = [await createTranslatorFor(fullLocale), createFormatterFor(fullLocale)];
  const chf = (rappen: number) => format.number(rappenToChf(rappen), "chf");
  const date = (value: Date) => format.dateTime(value, "dateLong");

  const pdf = new PDFDocument({ size: "A4", margin: MARGIN });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => pdf.on("end", () => resolve()));

  // Seller, top left.
  pdf.fontSize(9).fillColor("#666666");
  pdf.text(document.seller.name, MARGIN, MARGIN);
  pdf.text(document.seller.address);
  pdf.text(`${t("invoice.uid")} ${document.seller.uid}`);

  // Buyer, the window position of a Swiss C5 envelope.
  pdf.fontSize(11).fillColor("#000000");
  pdf.text(document.buyer.name, MARGIN, 170);
  pdf.text(document.buyer.street);
  pdf.text(`${document.buyer.postcode} ${document.buyer.town}`);
  if (document.buyer.country !== "CH") pdf.text(document.buyer.country);
  if (document.buyer.uid) {
    pdf
      .fontSize(9)
      .fillColor("#666666")
      .text(`${t("invoice.uid")} ${document.buyer.uid}`);
  }

  // Title and the document facts.
  pdf.fontSize(18).fillColor("#000000").text(t("invoice.title"), MARGIN, 260);
  pdf.fontSize(10).fillColor("#000000");
  pdf.moveDown(0.8);
  pdf.text(`${t("invoice.number")}: ${document.invoiceNumber}`);
  pdf.text(`${t("invoice.date")}: ${date(document.issuedAt)}`);
  pdf.text(`${t("invoice.due")}: ${date(document.dueDate)}`);
  pdf.text(`${t("invoice.orderReference")}: ${document.reference}`);

  // The line item and the three amounts, right aligned so the figures line up.
  const right = pdf.page.width - MARGIN;
  let y = 370;
  pdf.fontSize(9).fillColor("#666666");
  pdf.text(t("invoice.description"), MARGIN, y);
  y += 18;
  pdf.moveTo(MARGIN, y).lineTo(right, y).strokeColor("#cccccc").stroke();
  y += 10;

  pdf.fontSize(11).fillColor("#000000");
  pdf.text(document.lineDescription, MARGIN, y, { width: 320 });
  pdf.text(chf(document.netRappen), MARGIN, y, { width: right - MARGIN, align: "right" });
  y += 30;

  const row = (label: string, value: string, bold: boolean) => {
    pdf.fontSize(bold ? 12 : 10).fillColor("#000000");
    pdf.text(label, 300, y, { width: 150 });
    pdf.text(value, MARGIN, y, { width: right - MARGIN, align: "right" });
    y += bold ? 22 : 18;
  };
  row(t("invoice.net"), chf(document.netRappen), false);
  row(
    t("invoice.vat", { rate: format.number(document.vatRate, "percent") }),
    chf(document.vatRappen),
    false,
  );
  pdf.moveTo(300, y).lineTo(right, y).strokeColor("#cccccc").stroke();
  y += 8;
  row(t("invoice.gross"), chf(document.grossRappen), true);

  pdf
    .fontSize(9)
    .fillColor("#666666")
    .text(t("invoice.paymentNote"), MARGIN, y + 20);

  // The QR bill, which places itself at the foot of the page.
  const sellerAddress = splitSellerAddress(document.seller.address);
  const buyerStreet = splitStreet(document.buyer.street);
  const bill = new SwissQRBill({
    amount: rappenToChf(document.grossRappen),
    currency: "CHF",
    reference: document.qrReference,
    creditor: {
      account: document.seller.iban,
      name: document.seller.name,
      address: sellerAddress.street,
      buildingNumber: sellerAddress.buildingNumber,
      zip: sellerAddress.postcode,
      city: sellerAddress.town,
      country: "CH",
    },
    debtor: {
      name: document.buyer.name,
      address: buyerStreet.street,
      buildingNumber: buyerStreet.buildingNumber,
      zip: document.buyer.postcode,
      city: document.buyer.town,
      country: document.buyer.country,
    },
  });
  bill.attachTo(pdf);
  pdf.end();
  await finished;
  return Buffer.concat(chunks);
}

/** True when the seller facts are still placeholders, so a task can refuse to print a fake IBAN. */
export function sellerIsPlaceholder(iban: string): boolean {
  return iban === SELLER_PLACEHOLDERS.iban;
}
