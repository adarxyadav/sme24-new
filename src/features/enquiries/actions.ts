"use server";

import * as Sentry from "@sentry/nextjs";
import { localeFromCode } from "@/i18n/routing";
import { roleFromClaims } from "@/lib/auth/roles";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { queryError } from "@/lib/supabase/query-error";
import { parseWith } from "@/lib/validation";
import { type EnquiryStatus, leavesNew, updateEnquirySchema } from "./schema";

/**
 * The ops workflow action (spec 0009, AC-12): moves an enquiry between statuses and keeps the
 * ops note, through the server client under RLS (the column grant allows exactly these four
 * columns). Ops only, checked from the claims here and not only in the proxy.
 */

export type UpdateEnquiryResult =
  | { ok: true; data: { id: string; status: EnquiryStatus } }
  | { ok: false; error: "validation" | "forbidden" | "not_found" | "unavailable" };

/** Authorization lives in the action too, not only in the proxy. */
async function requireOps() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops" || typeof claims?.sub !== "string") return null;
  return { supabase, userId: claims.sub };
}

/**
 * Updates the status and the note (AC-12). `handled_by` and `handled_at` are set only the first
 * time the status leaves `new`: a first update `where status = 'new'` writes them together with
 * the change, then the plain update applies the status and the note. The stored status decides,
 * so two ops leaving `new` at once never both become the handler. Server action, ops.
 */
export async function updateEnquiry(
  _previous: UpdateEnquiryResult | null,
  input: unknown,
): Promise<UpdateEnquiryResult> {
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };
  const raw = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const locale = localeFromCode(typeof raw.locale === "string" ? raw.locale : undefined);
  const parsed = parseWith(updateEnquirySchema, raw, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { id, status, opsNote } = parsed.data;

  if (leavesNew(status)) {
    const { error } = await actor.supabase
      .from("enquiries")
      .update({
        status,
        ops_note: opsNote,
        handled_by: actor.userId,
        handled_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "new");
    if (error) return reportFailure("enquiry handler update failed", error);
  }

  const { data, error } = await actor.supabase
    .from("enquiries")
    .update({ status, ops_note: opsNote })
    .eq("id", id)
    .select("id, status")
    .maybeSingle();
  if (error) return reportFailure("enquiry update failed", error);
  if (!data) return { ok: false, error: "not_found" };

  log.info("enquiry updated", { id, status, by: actor.userId });
  return { ok: true, data: { id: data.id, status } };
}

function reportFailure(what: string, error: { readonly message: string }): UpdateEnquiryResult {
  log.error(what, { reason: error.message });
  Sentry.captureException(queryError(error), { tags: { source: "enquiry" } });
  return { ok: false, error: "unavailable" };
}
