import { createFormatter, createTranslator, type Messages } from "next-intl";
import { formats, TIME_ZONE } from "./formats";
import { getMessageFallback, onError } from "./on-error";
import type { Locale } from "./routing";

/** The same dynamic import as the request config, so tasks and emails read the one catalog. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  return (await import(`../../messages/${locale}.json`)).default;
}

/**
 * next-intl's translator with the app's catalog, formats, timezone and error handling, without a
 * request (AC-7). Runs in tasks (`src/trigger/`), server only code and React Email templates;
 * never in a request handler, which uses `getTranslations`.
 */
export async function createTranslatorFor(locale: Locale) {
  const messages = await loadMessages(locale);
  return createTranslator({
    locale,
    messages,
    formats,
    timeZone: TIME_ZONE,
    onError,
    getMessageFallback,
  });
}

/** next-intl's formatter with the named formats and the Swiss timezone, without a request (AC-7). Tasks, server only code and emails. */
export function createFormatterFor(locale: Locale) {
  return createFormatter({ locale, formats, timeZone: TIME_ZONE, onError });
}
