import { NextResponse } from "next/server";
import { getOrder } from "@/features/checkout/queries";
import { log } from "@/lib/logger";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** How long a download link lives. Long enough to click, short enough not to be shareable. */
const SIGNED_URL_SECONDS = 60;

/**
 * The invoice download (spec 0011, AC-4, AC-12). Reads the order under the caller's own session,
 * so row level security is the boundary: another organization's order simply is not there and the
 * route answers 404, never 403, which would confirm it exists.
 *
 * The object path is never sent to the browser; a signed URL is minted per request and expires,
 * so a copied link stops working rather than becoming a permanent public document.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();

  const found = await getOrder(supabase, id);
  // No order, or an order of another organization: the same answer either way.
  if (!found?.invoice?.pdf_path) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from("invoices")
    .createSignedUrl(found.invoice.pdf_path, SIGNED_URL_SECONDS);
  if (error || !data) {
    log.error("invoice download: could not sign the url", {
      orderId: id,
      message: error?.message,
    });
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  return NextResponse.redirect(data.signedUrl);
}
