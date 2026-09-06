/**
 * The browser's view of the environment (spec 0009 amendment 2026-09-06, AC-16): the six
 * `NEXT_PUBLIC_` values, each read as a literal so Next inlines it at build time, trimmed, and no
 * zod. It neither validates nor throws: the same six values are validated by the server schema in
 * `src/lib/env.ts` (`serverSchema` extends `clientSchema`) at build time (every layout calls
 * `clientEnv()` during prerender) and at boot, so an invalid value never reaches a browser bundle,
 * and an error thrown in the browser would help nobody. Server code keeps `clientEnv()`; a Biome
 * override keeps `@/lib/env` (and with it the zod runtime) out of browser modules.
 */

/** The public variables as the browser reads them. */
export type PublicEnv = {
  readonly NEXT_PUBLIC_SUPABASE_URL: string;
  readonly NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string;
  readonly NEXT_PUBLIC_APP_URL: string;
  readonly NEXT_PUBLIC_SENTRY_DSN: string | undefined;
  readonly NEXT_PUBLIC_POSTHOG_KEY: string | undefined;
  readonly NEXT_PUBLIC_POSTHOG_HOST: string;
};

const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

const trimmed = (value: string | undefined): string => (value ?? "").trim();

const optional = (value: string | undefined): string | undefined => {
  const text = trimmed(value);
  return text === "" ? undefined : text;
};

/** The six public variables for browser code (Sentry, analytics, the browser Supabase client). Browser, harmless on the server. */
export function publicEnv(): PublicEnv {
  return {
    NEXT_PUBLIC_SUPABASE_URL: trimmed(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: trimmed(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    NEXT_PUBLIC_APP_URL: trimmed(process.env.NEXT_PUBLIC_APP_URL),
    NEXT_PUBLIC_SENTRY_DSN: optional(process.env.NEXT_PUBLIC_SENTRY_DSN),
    NEXT_PUBLIC_POSTHOG_KEY: optional(process.env.NEXT_PUBLIC_POSTHOG_KEY),
    NEXT_PUBLIC_POSTHOG_HOST:
      optional(process.env.NEXT_PUBLIC_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST,
  };
}
