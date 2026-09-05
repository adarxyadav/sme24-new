import type { z } from "zod";
import { de, en } from "zod/locales";
import { LOCALE_CODE, type Locale, type LocaleCode } from "@/i18n/routing";

type ErrorMap = ReturnType<typeof de>["localeError"];

/** Zod's built in message locales by short code, mirroring `LOCALE_CODE`. Adding a locale adds a line here. */
const LOCALE_ERROR_FACTORY: Record<LocaleCode, () => { localeError: ErrorMap }> = { de, en };

const errorMaps = new Map<LocaleCode, ErrorMap>();

/**
 * Zod's built in messages (required, too short, invalid email) in the request language
 * (spec 0004, AC-8). Takes the full locale, maps it through `LOCALE_CODE` and memoises the map per
 * code. Pass it per parse or to `zodResolver`; Zod's global config is never mutated, so concurrent
 * requests in different languages cannot leak messages. Pure, runs anywhere.
 */
export function zodLocaleError(locale: Locale): ErrorMap {
  const code = LOCALE_CODE[locale];
  const cached = errorMaps.get(code);
  if (cached) return cached;
  const map = LOCALE_ERROR_FACTORY[code]().localeError;
  errorMaps.set(code, map);
  return map;
}

/**
 * `schema.safeParse` with the built in messages in the given language (AC-8). A server action that
 * receives a form reads the locale from the form's hidden `locale` field (the full tag); one called
 * with a plain object reads `getLocale()`. Server actions and server code.
 */
export function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
  locale: Locale,
): z.ZodSafeParseResult<z.output<Schema>> {
  return schema.safeParse(input, { error: zodLocaleError(locale) });
}

/**
 * The narrow view of a next-intl translator this module needs: `has` and the call, both accepting
 * whatever keys the namespace defines. A typed translator for any namespace is assignable to it.
 */
export type ValidationTranslator = {
  (key: never): string;
  has(key: never): boolean;
};

/**
 * The text for a form issue (AC-8): a custom rule carries a message key (`"companyShort"`) that the
 * feature's `validation` namespace translates; anything else (a built in message already in the
 * request language) renders as it is. Browser and server.
 */
export function issueMessage(
  message: string | undefined,
  t: ValidationTranslator,
): string | undefined {
  if (!message) return undefined;
  const key = message as never;
  return t.has(key) ? t(key) : message;
}
