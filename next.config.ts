import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // Spec 0001: authenticated areas are fully dynamic and the cache components mode stays off.
  cacheComponents: false,
  typedRoutes: false,
  poweredByHeader: false,
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
