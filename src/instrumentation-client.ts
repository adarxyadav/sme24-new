import { publicEnv } from "@/lib/env.public";

/**
 * Browser Sentry, loaded after the page (spec 0009 amendment 2026-09-06, AC-16). The SDK weighs
 * about 76 kB gzipped in the critical path, so nothing here imports it statically: it arrives
 * through `import()`. A signed in area starts the load at once (a hydration error in the dashboard
 * is what the SDK is for, and those pages have no LCP target); every other path waits for the
 * window `load` event (at once when the document is already `complete`), accepting that an error
 * before `load` on a public page goes unreported. The options are unchanged from the static init.
 * Runs in the browser only.
 */

type SentryModule = typeof import("@sentry/nextjs");
type RouterTransitionArgs = Parameters<SentryModule["captureRouterTransitionStart"]>;

/** The three areas the proxy gates, behind the locale prefix, followed by `/` or the end of the path. */
const SIGNED_IN_PATH = /^\/(de|en)\/(app|expert|admin)(\/|$)/;

let sentry: SentryModule | undefined;

function loadSentry(): void {
  const env = publicEnv();
  import("@sentry/nextjs")
    .then((module) => {
      module.init({
        dsn: env.NEXT_PUBLIC_SENTRY_DSN,
        enabled: Boolean(env.NEXT_PUBLIC_SENTRY_DSN),
        environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
        tracesSampleRate: 0.1,
        sendDefaultPii: false,
      });
      sentry = module;
    })
    .catch((error: unknown) => {
      console.warn("Sentry did not load", error);
    });
}

if (SIGNED_IN_PATH.test(window.location.pathname) || document.readyState === "complete") {
  loadSentry();
} else {
  window.addEventListener("load", loadSentry, { once: true });
}

/** Next's router transition hook: forwards to Sentry once the SDK is loaded and drops the call before that (the navigation loses its span, nothing else). Browser. */
export const onRouterTransitionStart = (...args: RouterTransitionArgs): void => {
  sentry?.captureRouterTransitionStart(...args);
};
