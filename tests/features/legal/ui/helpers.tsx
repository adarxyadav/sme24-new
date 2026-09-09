export { de, en, renderWithIntl, type TestLocale } from "../../emails/ui/helpers";

/**
 * The jsdom gaps the legal components fall into, installed per file rather than in
 * `tests/setup.ts`: `tests/chart.test.tsx` depends on `ResizeObserver` being absent, because that
 * absence is what keeps Recharts at the size it was given, so a global shim would break it.
 *
 * The cookie bar observes its own height to publish `--consent-bar-height`, and Radix's Select
 * measures its trigger with the same API.
 */
export function stubResizeObserver() {
  if (typeof globalThis.ResizeObserver !== "function") {
    class NoopResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: NoopResizeObserver,
    });
  }
}

/**
 * The layout APIs Radix's Select and Dialog reach for and jsdom does not implement. Without these
 * the select never opens and the assertion fails for a reason that has nothing to do with the
 * component under test.
 */
export function stubRadixEnvironment() {
  stubResizeObserver();
  for (const [name, value] of [
    ["scrollIntoView", () => {}],
    ["hasPointerCapture", () => false],
    ["setPointerCapture", () => {}],
    ["releasePointerCapture", () => {}],
  ] as const) {
    if (typeof Element !== "undefined") {
      Object.defineProperty(Element.prototype, name, { configurable: true, value });
    }
  }
}

export const REQUEST_ID = "0b000000-0000-4000-8000-000000000001";
export const OTHER_REQUEST_ID = "0b000000-0000-4000-8000-000000000002";

/**
 * The App Router hooks the legal components reach through `@/i18n/navigation`. next-intl's
 * `createNavigation` wraps `redirect` and `permanentRedirect` at import time, so a partial mock
 * that omits them fails the whole file before a single test runs.
 */
export function navigationMock() {
  const noop = () => {};
  return {
    usePathname: () => "/en",
    useSearchParams: () => new URLSearchParams(),
    useRouter: () => ({ push: noop, replace: noop, refresh: noop, prefetch: noop, back: noop }),
    useParams: () => ({ locale: "en-CH" }),
    redirect: noop,
    permanentRedirect: noop,
    notFound: noop,
  };
}
