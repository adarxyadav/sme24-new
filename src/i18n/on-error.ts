import { type IntlError, IntlErrorCode } from "next-intl";
import { log } from "@/lib/logger";

/** Keys already reported in this process, so Sentry gets each missing key once (AC-12). */
const reportedKeys = new Set<string>();

/** The codes that mean a catalog gap rather than a runtime hiccup. */
const CATALOG_CODES: readonly IntlErrorCode[] = [
  IntlErrorCode.MISSING_MESSAGE,
  IntlErrorCode.INVALID_MESSAGE,
];

/** The shape of Sentry's `captureException`, shared by `@sentry/nextjs` and `@sentry/node`. */
export type CaptureException = (
  error: unknown,
  context: { fingerprint: string[]; tags: Record<string, string> },
) => unknown;

/**
 * The message key next-intl quotes in backticks (`Could not resolve \`nav.nope\` in messages for
 * locale \`de-CH\`.`), so one key is reported once across locales and an invalid ICU fragment never
 * splits the Sentry group. Falls back to the whole message when there is no quoted key. Pure.
 */
export function messageKey(error: IntlError): string {
  return /`([^`]+)`/.exec(error.message)?.[1] ?? error.message;
}

/**
 * Builds the next-intl error handler shared by the request config and the standalone factory
 * (AC-12). Each caller passes its own runtime's `captureException` (`@sentry/nextjs` in the app,
 * `@sentry/node` in tasks), so the report always reaches the client that runtime configured. In
 * development and test a missing or invalid message throws, so the gap is found at once. In
 * production a catalog gap goes to Sentry once per key per process (the module level set guards
 * the call; the fingerprint only groups), and every other code is logged as a warning. Server and
 * tasks only, never the browser.
 */
export function createOnError(captureException: CaptureException) {
  return function onError(error: IntlError): void {
    const isCatalogGap = CATALOG_CODES.includes(error.code);
    if (process.env.NODE_ENV !== "production") {
      if (isCatalogGap) throw error;
      log.warn("intl error", { code: error.code, message: error.message });
      return;
    }
    if (!isCatalogGap) {
      log.warn("intl error", { code: error.code, message: error.message });
      return;
    }
    const key = messageKey(error);
    if (reportedKeys.has(key)) return;
    reportedKeys.add(key);
    captureException(error, {
      fingerprint: ["intl", error.code, key],
      tags: { source: "next-intl", code: error.code },
    });
  };
}

/** Renders the key path instead of crashing when a message is missing in production (AC-12). */
export function getMessageFallback({
  namespace,
  key,
}: {
  namespace?: string;
  key: string;
}): string {
  return namespace ? `${namespace}.${key}` : key;
}

/** Test helper: forget the reported keys so a test can assert the once per key rule. */
export function resetReportedKeys(): void {
  reportedKeys.clear();
}
