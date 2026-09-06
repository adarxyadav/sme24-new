import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK is mocked so the test sees when `init` runs; the module under test decides by the path
// and the document state whether to load it at once or after the window `load` event.
vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

type MockedSentry = {
  readonly init: ReturnType<typeof vi.fn>;
  readonly captureRouterTransitionStart: ReturnType<typeof vi.fn>;
};

const DSN = "https://k@o.ingest.de.sentry.io/1";
let readyState: DocumentReadyState = "loading";

/** Sets the path and the document state, then loads the instrumentation module fresh. */
async function boot(pathname: string, state: DocumentReadyState) {
  readyState = state;
  window.history.replaceState(null, "", pathname);
  vi.resetModules();
  const sentry = (await import("@sentry/nextjs")) as unknown as MockedSentry;
  const client = await import("@/instrumentation-client");
  return { sentry, client };
}

/** Lets a resolved `import()` run its `then`. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const fireLoad = async () => {
  window.dispatchEvent(new Event("load"));
  await settle();
};

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
  Object.defineProperty(document, "readyState", { configurable: true, get: () => readyState });
});

afterEach(() => {
  vi.unstubAllEnvs();
  readyState = "loading";
  window.history.replaceState(null, "", "/");
});

describe("the deferred browser Sentry (spec 0009 amendment, AC-16)", () => {
  it("loads the SDK at once in a signed in area without waiting for load", async () => {
    const { sentry } = await boot("/en/app", "loading");
    await settle();
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init).toHaveBeenCalledWith({
      dsn: DSN,
      enabled: true,
      environment: expect.any(String),
      tracesSampleRate: 0.1,
      sendDefaultPii: false,
    });
  });

  it.each(["/de/admin/enquiries", "/en/expert", "/de/app/onboarding"])(
    "treats %s as a signed in path",
    async (pathname) => {
      const { sentry } = await boot(pathname, "loading");
      await settle();
      expect(sentry.init).toHaveBeenCalledTimes(1);
    },
  );

  it("waits for the load event on a public page", async () => {
    const { sentry } = await boot("/en/pricing", "loading");
    await settle();
    expect(sentry.init).not.toHaveBeenCalled();
    await fireLoad();
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("does not mistake a public path that merely starts like an area for a signed in one", async () => {
    const { sentry } = await boot("/en/apple", "loading");
    await settle();
    expect(sentry.init).not.toHaveBeenCalled();
    await fireLoad();
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("loads at once when the document is already complete", async () => {
    const { sentry } = await boot("/de/kontakt", "complete");
    await settle();
    expect(sentry.init).toHaveBeenCalledTimes(1);
  });

  it("keeps the SDK disabled when no DSN is set", async () => {
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    const { sentry } = await boot("/en/app", "loading");
    await settle();
    expect(sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: undefined, enabled: false }),
    );
  });

  it("drops a router transition before the SDK is loaded and forwards it after", async () => {
    const { sentry, client } = await boot("/en/pricing", "loading");
    await settle();
    client.onRouterTransitionStart("/en/about", "push");
    expect(sentry.captureRouterTransitionStart).not.toHaveBeenCalled();
    await fireLoad();
    client.onRouterTransitionStart("/en/contact", "replace");
    expect(sentry.captureRouterTransitionStart).toHaveBeenCalledTimes(1);
    expect(sentry.captureRouterTransitionStart).toHaveBeenCalledWith("/en/contact", "replace");
  });
});
