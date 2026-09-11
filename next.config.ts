import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Spec 0017 (AC-10): the deploy every Sentry event is tagged with. Vercel sets the unprefixed SHA
 * on the build; the `NEXT_PUBLIC_` copy exists only when a project has "system environment
 * variables" enabled, so the browser release is derived here instead of depending on that toggle.
 */
const RELEASE = process.env.VERCEL_GIT_COMMIT_SHA;

const nextConfig: NextConfig = {
  // The browser Sentry init reads this; inlined at build so it never depends on the Vercel toggle.
  env: { NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: RELEASE ?? "" },
  // Spec 0001: authenticated areas are fully dynamic and the cache components mode stays off.
  cacheComponents: false,
  typedRoutes: false,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Spec 0013 AC-6 promises a 2 MB expert photo, but Next caps a server action body at 1 MB by
      // default and rejects the request before the action runs, so `uploadExpertPhoto` never sees
      // it and cannot answer `too_large`. The cap counts the raw body, multipart boundaries and
      // part headers included, so the headroom above 2 MB is what lets the action's own check fire.
      bodySizeLimit: "3mb",
    },
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  // Source map upload only happens when SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set (CI and Vercel builds).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Must match the `release` passed to every Sentry.init exactly, or uploaded source maps are
  // filed under a build detected name while events report the SHA, and no trace resolves.
  release: RELEASE ? { name: RELEASE } : undefined,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
});
