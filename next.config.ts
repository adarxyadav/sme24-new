import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
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
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
});
