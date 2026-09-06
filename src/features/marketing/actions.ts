"use server";

import { createHash, randomUUID } from "node:crypto";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";
import { localeFromCode } from "@/i18n/routing";
import { sendOpsAlert } from "@/lib/alerts/send";
import { captureServerEvent } from "@/lib/analytics/server";
import { organizationIdFromClaims, roleFromClaims } from "@/lib/auth/roles";
import { ENQUIRY_RECEIVED_EVENT } from "@/lib/email/schema";
import { sendEmail } from "@/lib/email/send";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { createActionClient } from "@/lib/supabase/action";
import { queryError } from "@/lib/supabase/query-error";
import { createServiceClient } from "@/lib/supabase/service";
import { parseWith } from "@/lib/validation";
import {
  EMAIL_DAILY_LIMIT,
  ENQUIRY_TOPIC_LABELS,
  enquirySubmissionSchema,
  IP_HOURLY_LIMIT,
  MIN_FILL_MS,
} from "./schema";

/**
 * The contact form's server action (spec 0009, AC-9, AC-10): guards against bots and floods,
 * stores the enquiry through the service client (an anonymous visitor has no session), then
 * alerts ops and acknowledges the sender through the rails of spec 0006. Always a dynamic
 * request, even when the page that calls it is prerendered. Never throws for an expected
 * failure; a database error answers `unavailable` and reaches Sentry.
 */

export type EnquiryActionResult =
  | { ok: true; data: { id: string } }
  | { ok: false; error: "validation"; fields: Readonly<Record<string, string>> }
  | { ok: false; error: "rate_limited" | "unavailable" };

const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;
/** The provisional funnel event name; feature 15 fixes the taxonomy. */
const ENQUIRY_SENT_EVENT = "enquiry_sent";

/**
 * Stores one enquiry and fires the alert and the acknowledgement (AC-9, AC-10). Order: the
 * honeypot and the timing check (a bot gets `ok` and nothing is stored), the schema, the two
 * counted rate limits, the insert, then the alert, the email and the PostHog event, none of
 * which can lose the row. Server action, public; the claims are read when a session exists.
 */
export async function submitEnquiry(
  _previous: EnquiryActionResult | null,
  input: unknown,
): Promise<EnquiryActionResult> {
  const raw = isRecord(input) ? input : {};
  const botReason = detectBot(raw);
  if (botReason) {
    log.info("enquiry rejected", { reason: botReason });
    // A decoy id: a bot cannot tell the honeypot from success (key invariant).
    return { ok: true, data: { id: randomUUID() } };
  }

  const locale = localeFromCode(typeof raw.locale === "string" ? raw.locale : undefined);
  const parsed = parseWith(enquirySubmissionSchema, raw, locale);
  if (!parsed.success) {
    return { ok: false, error: "validation", fields: issueFields(parsed.error.issues) };
  }
  const values = parsed.data;

  const [ipHash, actor] = await Promise.all([hashCallerAddress(), signedInClient()]);
  const env = serverEnv();
  const service = createServiceClient(env.SUPABASE_SECRET_KEY, env.NEXT_PUBLIC_SUPABASE_URL);

  const limited = await isRateLimited(service, ipHash, values.email);
  if (limited === "error") return { ok: false, error: "unavailable" };
  if (limited) {
    log.info("enquiry rate limited", { byAddress: ipHash !== null, locale: values.locale });
    return { ok: false, error: "rate_limited" };
  }

  const { data: row, error } = await service
    .from("enquiries")
    .insert({
      topic: values.topic,
      company_name: values.companyName,
      contact_name: values.contactName,
      email: values.email,
      phone: values.phone,
      headcount_band: values.headcountBand,
      message: values.message,
      locale: values.locale,
      ip_hash: ipHash,
      organization_id: actor?.organizationId ?? null,
      submitted_by: actor?.userId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    reportDatabaseError("enquiry insert failed", error);
    return { ok: false, error: "unavailable" };
  }
  const id = row.id;
  log.info("enquiry stored", {
    id,
    topic: values.topic,
    locale: values.locale,
    organizationId: actor?.organizationId ?? null,
  });

  // The row is stored; nothing below can lose it. Both triggers carry a global key per row, so a
  // retry of the action or a double click never sends twice (key invariant).
  const [alert, email] = await Promise.all([
    sendOpsAlert({
      kind: ENQUIRY_RECEIVED_EVENT,
      fields: { organizationName: values.companyName, topic: ENQUIRY_TOPIC_LABELS[values.topic] },
      link: `/admin/enquiries/${id}`,
      idempotencyKey: `enquiry/${id}/alert`,
    }),
    sendEmail({
      template: "enquiry_received",
      data: { contactName: values.contactName, topic: values.topic },
      recipient: { email: values.email, locale: values.locale },
      sourceEvent: ENQUIRY_RECEIVED_EVENT,
      idempotencyKey: `enquiry/${id}/ack`,
    }),
  ]);
  if (!alert.ok) log.warn("enquiry alert not sent", { id, error: alert.error });
  if (!email.ok) log.warn("enquiry acknowledgement not sent", { id, error: email.error });

  try {
    await captureServerEvent({
      distinctId: id,
      event: ENQUIRY_SENT_EVENT,
      properties: { topic: values.topic, locale: values.locale },
    });
  } catch (cause) {
    log.warn("enquiry event not captured", { id, reason: String(cause) });
  }

  return { ok: true, data: { id } };
}

type BotReason = "honeypot" | "too_fast" | "no_start";

/** The honeypot and the timing check on the raw input, before any parse (AC-10). */
function detectBot(raw: Record<string, unknown>): BotReason | null {
  if (typeof raw.website === "string" && raw.website.trim() !== "") return "honeypot";
  const startedAt = typeof raw.startedAt === "string" ? Number(raw.startedAt) : Number.NaN;
  if (!Number.isFinite(startedAt)) return "no_start";
  if (Date.now() - startedAt < MIN_FILL_MS) return "too_fast";
  return null;
}

/** The per field message of each issue, keyed by the field name (AC-10). */
function issueFields(
  issues: ReadonlyArray<{ readonly path: ReadonlyArray<PropertyKey>; readonly message: string }>,
): Record<string, string> {
  return Object.fromEntries(
    issues
      .filter((issue) => typeof issue.path[0] === "string")
      .map((issue) => [String(issue.path[0]), issue.message]),
  );
}

/**
 * The SHA 256 hex of the caller's address (the first `x-forwarded-for` entry, else `x-real-ip`),
 * or null when neither header is set (a direct local request). Never the address itself.
 */
async function hashCallerAddress(): Promise<string | null> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || requestHeaders.get("x-real-ip")?.trim() || null;
  return address ? createHash("sha256").update(address).digest("hex") : null;
}

type SignedInClient = { readonly userId: string; readonly organizationId: string | null };

/**
 * The signed in client behind the request, when the claims carry the `client` role; an ops or
 * expert tester's submission stays anonymous on the row (AC-9).
 */
async function signedInClient(): Promise<SignedInClient | null> {
  const supabase = await createActionClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (roleFromClaims(claims) !== "client" || typeof claims?.sub !== "string") return null;
  return { userId: claims.sub, organizationId: organizationIdFromClaims(claims) };
}

type Service = ReturnType<typeof createServiceClient>;

/**
 * The two counted rate limits (AC-10): by address hash in the last hour and by email in the last
 * 24 hours. The counts and the insert are not atomic, so the limit is best effort. `"error"`
 * when a count query fails (reported to Sentry).
 */
async function isRateLimited(
  service: Service,
  ipHash: string | null,
  email: string,
): Promise<boolean | "error"> {
  const now = Date.now();
  const byAddress = ipHash
    ? service
        .from("enquiries")
        .select("id", { count: "exact", head: true })
        .eq("ip_hash", ipHash)
        .gte("created_at", new Date(now - HOUR_MS).toISOString())
    : Promise.resolve({ count: 0, error: null });
  const byEmail = service
    .from("enquiries")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", new Date(now - DAY_MS).toISOString());
  const [addressResult, emailResult] = await Promise.all([byAddress, byEmail]);
  const failed = addressResult.error ?? emailResult.error;
  if (failed) {
    reportDatabaseError("enquiry rate limit count failed", failed);
    return "error";
  }
  return (
    (addressResult.count ?? 0) >= IP_HOURLY_LIMIT || (emailResult.count ?? 0) >= EMAIL_DAILY_LIMIT
  );
}

function reportDatabaseError(what: string, error: { readonly message: string }): void {
  log.error(what, { reason: error.message });
  Sentry.captureException(queryError(error), { tags: { source: "enquiry" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
