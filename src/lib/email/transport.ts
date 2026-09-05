import nodemailer from "nodemailer";
import { Resend } from "resend";

/** Where the message leaves: the Resend API when a key is set, else SMTP (Mailpit locally). */
export type Transport = "resend" | "smtp";

export type OutboundEmail = {
  readonly from: string;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** `<deliveryId>/<attempts>`: Resend deduplicates a retried request, never an earlier attempt. */
  readonly idempotencyKey: string;
  readonly template: string;
};

/**
 * The outcome the task acts on (spec 0006, AC-7): a permanent failure marks the row failed at
 * once, a transient one is thrown so Trigger.dev retries.
 */
export type SendOutcome =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | {
      readonly ok: false;
      readonly kind: "permanent" | "transient";
      readonly message: string;
      readonly status: number | null;
    };

/** The local sender when SMTP is the transport and `EMAIL_FROM` is unset. */
export const LOCAL_EMAIL_FROM = "SME24 <no-reply@sme24.local>";

/** Picks the transport from the environment: Resend first, then SMTP, else none (the row is skipped). Pure. */
export function chooseTransport(env: {
  readonly RESEND_API_KEY?: string;
  readonly EMAIL_SMTP_URL?: string;
}): Transport | null {
  if (env.RESEND_API_KEY) return "resend";
  if (env.EMAIL_SMTP_URL) return "smtp";
  return null;
}

/**
 * True when the address may be mailed (AC-6): no allowlist, or an exact address or `@domain`
 * match, case insensitive. Pure.
 */
export function isAllowedRecipient(
  address: string,
  allowlist: readonly string[] | undefined,
): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const lower = address.trim().toLowerCase();
  const domain = lower.slice(lower.lastIndexOf("@"));
  return allowlist.some((entry) => entry === lower || (entry.startsWith("@") && entry === domain));
}

/**
 * Maps a Resend error to the retry class (AC-7): a 429, a 5xx or a request without a status (a
 * network failure) is transient; any other 4xx is permanent. Pure.
 */
export function classifyHttpFailure(status: number | null): "permanent" | "transient" {
  if (status === null) return "transient";
  if (status === 429 || status >= 500) return "transient";
  return "permanent";
}

/**
 * Sends through the Resend API (AC-5) with the idempotency key, the `template` tag, the sender and
 * the reply address. The SDK never throws for an API error, it returns `{ error }`; a thrown error
 * is a network failure and counts as transient. Task only.
 */
export async function sendViaResend(apiKey: string, message: OutboundEmail): Promise<SendOutcome> {
  const resend = new Resend(apiKey);
  try {
    const { data, error } = await resend.emails.send(
      {
        from: message.from,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [{ name: "template", value: message.template }],
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      },
      { idempotencyKey: message.idempotencyKey },
    );
    if (error) {
      const status = error.statusCode ?? null;
      return { ok: false, kind: classifyHttpFailure(status), message: error.message, status };
    }
    return { ok: true, providerMessageId: data.id };
  } catch (error) {
    return { ok: false, kind: "transient", message: errorMessage(error), status: null };
  }
}

/**
 * Sends through SMTP (AC-5), Mailpit on the local stack. nodemailer's message id is not stored,
 * so the row stops at `sent`. An SMTP 5xx reply is permanent, a 4xx reply or a connection error is
 * transient (SMTP reads the classes the other way round from HTTP). Task only.
 */
export async function sendViaSmtp(smtpUrl: string, message: OutboundEmail): Promise<SendOutcome> {
  const transporter = nodemailer.createTransport(smtpUrl);
  try {
    await transporter.sendMail({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { ok: true, providerMessageId: null };
  } catch (error) {
    const code = smtpResponseCode(error);
    const kind = code !== null && code >= 500 ? "permanent" : "transient";
    return { ok: false, kind, message: errorMessage(error), status: code };
  } finally {
    transporter.close();
  }
}

function smtpResponseCode(error: unknown): number | null {
  if (typeof error === "object" && error !== null && "responseCode" in error) {
    const code = (error as { responseCode: unknown }).responseCode;
    return typeof code === "number" ? code : null;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
