import { captureException } from "@sentry/nextjs";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { formats, TIME_ZONE } from "./formats";
import { createOnError, getMessageFallback } from "./on-error";
import { routing } from "./routing";

/** The app runtime's handler: catalog gaps reach the Sentry client `sentry.server.config.ts` set up. */
const onError = createOnError(captureException);

/** Request scoped next-intl config (spec 0004): locale from the URL segment, the one catalog per locale, the named formats and the Swiss timezone. Server. */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    formats,
    timeZone: TIME_ZONE,
    onError,
    getMessageFallback,
  };
});
