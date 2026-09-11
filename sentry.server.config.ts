import * as Sentry from "@sentry/nextjs";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/logger";

const env = serverEnv();

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    // Spec 0017 (AC-10): the deploy an error came from. Vercel sets the SHA at build; undefined
    // locally, where an unversioned error is correct rather than mislabelled as a release.
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  });
} else {
  log.warn("Sentry disabled on the server: SENTRY_DSN is not set");
}
