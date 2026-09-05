/**
 * Reads auth emails from Mailpit, the mail catcher of the local Supabase stack (spec 0005, test
 * scenarios). Only the local stack has one, so email dependent specs skip when PLAYWRIGHT_BASE_URL
 * points at a deployment. Playwright.
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";

/**
 * True when the tests run against a local dev server (Playwright's own, or one named through a
 * localhost PLAYWRIGHT_BASE_URL), so Mailpit is reachable in principle; a deployment has none.
 */
export const mailAvailable =
  !process.env.PLAYWRIGHT_BASE_URL ||
  /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(process.env.PLAYWRIGHT_BASE_URL);

export type Mail = {
  readonly id: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** Every `href` in the HTML body, decoded. */
  readonly links: readonly string[];
};

type SearchResponse = { messages?: ReadonlyArray<{ ID: string; Created: string }> };
type MessageResponse = { Subject: string; HTML: string; Text: string };

/** A unique address per run, so Supabase's per address send frequency limit never bites. */
export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`;
}

/** The ids Mailpit currently holds for an address, newest first. */
async function search(address: string): Promise<string[]> {
  const url = new URL("/api/v1/search", MAILPIT_URL);
  url.searchParams.set("query", `to:"${address}"`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const body = (await response.json()) as SearchResponse;
  return (body.messages ?? []).map((message) => message.ID);
}

async function fetchMessage(id: string): Promise<Mail> {
  const response = await fetch(new URL(`/api/v1/message/${id}`, MAILPIT_URL));
  if (!response.ok) throw new Error(`Mailpit message failed: ${response.status}`);
  const body = (await response.json()) as MessageResponse;
  const links = [...body.HTML.matchAll(/href="([^"]+)"/g)].map((match) =>
    (match[1] ?? "").replaceAll("&amp;", "&"),
  );
  return { id, subject: body.Subject, html: body.HTML, text: body.Text, links };
}

/**
 * Waits for the newest email to `address` that was not among `seen` (the ids returned by an
 * earlier call), polling Mailpit up to `timeoutMs`.
 */
export async function readMail(
  address: string,
  { seen = [], timeoutMs = 20_000 }: { seen?: readonly string[]; timeoutMs?: number } = {},
): Promise<Mail> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fresh = (await search(address)).filter((id) => !seen.includes(id));
    const [newest] = fresh;
    if (newest) return fetchMessage(newest);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`no email for ${address} within ${timeoutMs}ms`);
}

/** The ids currently held for an address, to pass as `seen` before triggering a new email. */
export async function mailIds(address: string): Promise<string[]> {
  return search(address);
}

/** True when no email arrives for the address within `waitMs` (a "sends nothing" assertion). */
export async function noMailFor(
  address: string,
  seen: readonly string[],
  waitMs = 4_000,
): Promise<boolean> {
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  const fresh = (await search(address)).filter((id) => !seen.includes(id));
  return fresh.length === 0;
}

/** The first link of a mail that points at the confirm handler. */
export function confirmLink(mail: Mail): string {
  const link = mail.links.find((href) => href.includes("/api/auth/confirm"));
  if (!link) throw new Error(`no confirm link in "${mail.subject}"`);
  return link;
}

/**
 * The path plus query of an absolute link, so the browser opens it on the test server (the email
 * carries the configured site URL, which may be another port).
 */
export function linkPath(href: string): string {
  const url = new URL(href);
  return `${url.pathname}${url.search}`;
}

/** The six digit code printed in a magic link email. */
export function codeIn(mail: Mail): string {
  const match = mail.text.match(/\b(\d{6})\b/) ?? mail.html.match(/>\s*(\d{6})\s*</);
  if (!match?.[1]) throw new Error(`no six digit code in "${mail.subject}"`);
  return match[1];
}
