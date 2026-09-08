"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { resolveLocale } from "@/i18n/routing";
import { createFormatterFor } from "@/i18n/standalone";
import { sendOpsAlert } from "@/lib/alerts/send";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import { anonymisePerson } from "./anonymise";
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  type ConsentChoice,
  consentCookieValue,
  isConsentChoice,
} from "./consent";
import {
  canTransition,
  DATA_REQUEST_RECEIVED_EVENT,
  type DataRequestKind,
  type DataRequestStatus,
  dueAtFrom,
  refusalNoteMissing,
  requestDataSchema,
  updateDataRequestSchema,
} from "./schema";
import { CURRENT_TERMS_VERSION } from "./terms";

/** The Swiss date the alert states as the answer deadline: 09.10.2026, in the English channel. */
function formatSwissDate(date: Date): string {
  return createFormatterFor("en-CH").dateTime(date, "dateShort");
}

/**
 * The legal server actions (spec 0015): the consent cookie, the terms acceptance, and the data
 * subject requests a person files and ops work. `setConsent` is the only write path for the consent
 * cookie: a POST writes it with the app's own `cookies()`, never client script, so the value
 * stays out of a third party script's reach and the reject path works without JavaScript.
 * `acceptTerms` is the only write path for the two consent columns on the profile.
 */

export type SetConsentResult = { ok: true } | { ok: false; error: "validation" };

/**
 * Stores the visitor's answer to the cookie bar (AC-3). First party, `SameSite=Lax`, readable by
 * the bar after mount (so not `HttpOnly`), `Secure` only in production so `pnpm dev` over plain
 * HTTP keeps working, one year. Server action, public: a visitor has no session.
 */
export async function setConsent(choice: ConsentChoice): Promise<SetConsentResult> {
  if (!isConsentChoice(choice)) return { ok: false, error: "validation" };

  const cookieStore = await cookies();
  cookieStore.set(CONSENT_COOKIE, consentCookieValue(choice), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CONSENT_MAX_AGE_SECONDS,
  });
  return { ok: true };
}

/**
 * Forgets the stored answer so the bar opens again (AC-8b), for the control on `/cookies`. The
 * cookie is deleted server side like every other write to it, so nothing in the browser ever
 * assigns `document.cookie`. Server action, public.
 */
export async function clearConsent(): Promise<SetConsentResult> {
  const cookieStore = await cookies();
  cookieStore.delete(CONSENT_COOKIE);
  return { ok: true };
}

export type AcceptTermsResult =
  | { ok: true; data: { version: string } }
  | { ok: false; error: "forbidden" | "unexpected" };

/**
 * Records the caller's acceptance of the current terms (AC-10), the one way out of the re consent
 * dialog. The version is `CURRENT_TERMS_VERSION`, never a form field: the client is being asked to
 * accept what this build shows them, so letting the browser name the version would let it accept a
 * version it never rendered.
 *
 * Writes through `accept_terms()` on the caller's own client, because both columns sit outside the
 * authenticated column grant and the definer function's `auth.uid()` check is what keeps the write
 * to the caller's own row. Idempotent: accepting a version already stored changes nothing.
 *
 * Returns a typed result and never throws for an expected failure. Server action, any signed in
 * role.
 */
export async function acceptTerms(): Promise<AcceptTermsResult> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  if (typeof data?.claims?.sub !== "string") return { ok: false, error: "forbidden" };

  const { error } = await supabase.rpc("accept_terms", { version: CURRENT_TERMS_VERSION });
  if (error) {
    log.error("accept_terms failed", { reason: error.message });
    Sentry.captureException(new Error(`accept_terms failed: ${error.message}`), {
      tags: { source: "legal" },
    });
    return { ok: false, error: "unexpected" };
  }
  return { ok: true, data: { version: CURRENT_TERMS_VERSION } };
}

export type RequestDataResult =
  | { ok: true; data: { id: string; kind: DataRequestKind } }
  | { ok: false; error: "validation" | "forbidden" | "already_open" | "unexpected" };

/**
 * Files a data subject request for the caller themselves (AC-11, AC-13). Any signed in role may:
 * an expert and an ops user have the same right a client does.
 *
 * `requested_by` is the caller's own id from the claims, never a form field, and the insert policy
 * checks it again in the database. The due date is thirty days on, computed here and passed in,
 * because the column has no default: the deadline is a fact about the request rather than about
 * the row's storage, and a recomputation later would silently move it.
 *
 * The duplicate guard is the partial unique index, never an application read: two rapid
 * submissions both pass a read-then-write, and only the index refuses the second. A 23505 comes
 * back as the typed `already_open` rather than as an opaque database error the user sees.
 *
 * The alert fires only after the row is stored, and never fails the caller: a request that was
 * filed and not announced is a Slack gap ops can close from `/admin/data-requests`, while an
 * announcement of a row that was never written is the failure nobody can undo. Server action,
 * any signed in role.
 */
export async function requestData(
  _previous: RequestDataResult | null,
  input: unknown,
): Promise<RequestDataResult> {
  const locale = resolveLocale(await getLocale());
  const supabase = await createActionClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (typeof claims?.sub !== "string") return { ok: false, error: "forbidden" };
  const userId = claims.sub;

  const parsed = parseWith(requestDataSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { kind } = parsed.data;

  const now = new Date();
  const { data, error } = await supabase
    .from("data_requests")
    .insert({
      kind,
      requested_by: userId,
      organization_id: organizationIdFromClaims(claims) ?? null,
      due_at: dueAtFrom(now).toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    // 23505 is the open guard: one request of this kind is already queued for this person.
    if (error.code === "23505") return { ok: false, error: "already_open" };
    log.error("data request insert failed", { reason: error.message });
    Sentry.captureException(queryError(error), { tags: { source: "legal" } });
    return { ok: false, error: "unexpected" };
  }

  // The row is stored; nothing below can lose it. The key is per row, so a retry never alerts twice.
  const email = typeof claims.email === "string" ? claims.email : "unknown@invalid";
  const alert = await sendOpsAlert({
    kind: DATA_REQUEST_RECEIVED_EVENT,
    fields: { kind, email, dueOn: formatSwissDate(dueAtFrom(now)) },
    link: `/admin/data-requests/${data.id}`,
    idempotencyKey: `data-request/${data.id}/alert`,
  });
  if (!alert.ok) log.warn("data request alert not sent", { id: data.id, reason: alert.error });

  log.info("data request filed", { id: data.id, kind, by: userId });
  revalidatePath("/app/settings");
  return { ok: true, data: { id: data.id, kind } };
}

export type UpdateDataRequestResult =
  | { ok: true; data: { id: string; status: DataRequestStatus } }
  | {
      ok: false;
      error:
        | "validation"
        | "forbidden"
        | "not_found"
        | "invalid_transition"
        | "note_required"
        | "unexpected";
    };

/**
 * Moves a request through the workflow and keeps the ops note (AC-14, AC-15).
 *
 * `UPDATE` on `data_requests` is revoked from every app role, so this authorises the ops caller
 * itself — the proxy never runs for a server action post — and writes through the service client
 * `requireOps` mints, the same shape spec 0014 uses for orders.
 *
 * The transition is checked against the stored status, read in the same action, and the write is
 * then guarded on that status, so two ops users moving the same row at once cannot both win: the
 * second reads zero rows and is told `invalid_transition` rather than overwriting the first.
 *
 * A deletion reaching `fulfilled` anonymises the person **before** the row records the fulfilment.
 * That order is the point: a throw from `anonymisePerson` leaves the request open and honest,
 * where recording first would leave a row claiming a deletion that did not happen. Server action,
 * ops only.
 */
export async function updateDataRequest(
  _previous: UpdateDataRequestResult | null,
  input: unknown,
): Promise<UpdateDataRequestResult> {
  const locale = resolveLocale(await getLocale());
  const actor = await requireOps();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseWith(updateDataRequestSchema, input, locale);
  if (!parsed.success) return { ok: false, error: "validation" };
  const { id, status, opsNote } = parsed.data;

  if (refusalNoteMissing(status, opsNote)) return { ok: false, error: "note_required" };

  const { data: current, error: readError } = await actor.service
    .from("data_requests")
    .select("id, kind, status, requested_by, handled_by")
    .eq("id", id)
    .maybeSingle();
  if (readError) return reportUpdateFailure("data request read failed", readError.message);
  if (!current) return { ok: false, error: "not_found" };

  const from = current.status as DataRequestStatus;
  if (!canTransition(from, status)) return { ok: false, error: "invalid_transition" };

  if (current.kind === "deletion" && status === "fulfilled") {
    if (!current.requested_by) {
      // The profile is already gone, so there is nothing left to anonymise and the fulfilment is
      // truthful as it stands. Recorded rather than refused: the right was still answered.
      log.info("data request deletion: subject already gone", { id });
    } else {
      try {
        const outcome = await anonymisePerson(actor.service, current.requested_by);
        log.info("data request deletion anonymised", { id, ...outcome });
      } catch (error) {
        log.error("anonymisation failed", { id, reason: String(error) });
        Sentry.captureException(error, { tags: { source: "legal" } });
        return { ok: false, error: "unexpected" };
      }
    }
  }

  // `handled_by` and `handled_at` are written the first time the status leaves `new`, in the same
  // statement as the change, and never cleared afterwards (the check constraint keeps them paired).
  const handled =
    current.handled_by === null
      ? { handled_by: actor.userId, handled_at: new Date().toISOString() }
      : {};

  const { data, error } = await actor.service
    .from("data_requests")
    .update({ status, ops_note: opsNote, ...handled })
    .eq("id", id)
    .eq("status", from)
    .select("id, status")
    .maybeSingle();
  if (error) return reportUpdateFailure("data request update failed", error.message);
  // Zero rows means the stored status moved between the read and the write: another ops user got
  // there first, so this move is no longer the one the adjacency list allowed.
  if (!data) return { ok: false, error: "invalid_transition" };

  log.info("data request updated", { id, from, to: status, by: actor.userId });
  revalidatePath("/admin/data-requests");
  revalidatePath(`/admin/data-requests/${id}`);
  return { ok: true, data: { id: data.id, status } };
}

/** The ops caller with a service client, since these writes sit outside every app role's grants. */
async function requireOps() {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "ops" || typeof claims?.sub !== "string") return null;
  const env = serverEnv();
  return {
    userId: claims.sub,
    service: createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL),
  };
}

function reportUpdateFailure(what: string, reason: string): UpdateDataRequestResult {
  log.error(what, { reason });
  Sentry.captureException(new Error(`${what}: ${reason}`), { tags: { source: "legal" } });
  return { ok: false, error: "unexpected" };
}
