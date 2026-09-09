// biome-ignore-all lint/suspicious/noDocumentCookie: this suite drives the real jsdom cookie jar on
// purpose, the same way `consent-store.test.tsx` does. The gate reads the consent store, which
// reads `document.cookie` itself, so seeding the jar is what puts the provider in the state under
// test; the Cookie Store API the rule prefers is not implemented in jsdom.
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONSENT_VERSION } from "@/features/legal/consent";
import { refreshConsent } from "@/features/legal/consent-store";

/**
 * The one analytics gate (spec 0015, AC-1, AC-3, AC-4). This is the module that decides whether
 * PostHog runs at all, so the branches below are the whole compliance claim in code: nothing loads
 * without a key, nothing loads without a current `granted` answer, and withdrawal in the same tab
 * stops collection and drops the identity rather than waiting for a reload.
 *
 * The re-accept branch matters as much as the withdrawal one: `opt_in_capturing` on a library that
 * is still in memory, never a second `init`, which would double count every event. That is the
 * distinction the review found untested, and it is invisible to the e2e suite, which reloads with a
 * cookie already set rather than moving between answers in one tab.
 *
 * `posthog-js` is mocked because the real module opens a network client on import; the gate's
 * contract with it is exactly the four calls asserted here.
 */

const posthog = vi.hoisted(() => ({
  __loaded: false,
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("posthog-js", () => ({ default: posthog }));

const env = vi.hoisted(() => ({
  NEXT_PUBLIC_POSTHOG_KEY: "phc_test" as string | undefined,
  NEXT_PUBLIC_POSTHOG_HOST: "https://eu.i.posthog.test",
}));

vi.mock("@/lib/env.public", () => ({ publicEnv: () => env }));

const { AnalyticsProvider } = await import("@/lib/analytics/client");

/** Writes the consent cookie the way the server action would, then wakes the store. */
function storeChoice(choice: "granted" | "denied") {
  document.cookie = `sme24_consent=${choice}.${CONSENT_VERSION}; path=/`;
  act(() => {
    refreshConsent();
  });
}

/** Deletes the cookie the way `clearConsent` would, then wakes the store. */
function clearCookie() {
  document.cookie = "sme24_consent=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  act(() => {
    refreshConsent();
  });
}

/**
 * The gate imports `posthog-js` inside the effect, so the assertion has to run after that promise
 * settles rather than straight after `render`.
 */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  posthog.__loaded = false;
  vi.clearAllMocks();
  env.NEXT_PUBLIC_POSTHOG_KEY = "phc_test";
});

afterEach(() => {
  clearCookie();
});

describe("AnalyticsProvider", () => {
  it("renders its children whatever the answer is", () => {
    const { getByTestId } = render(
      <AnalyticsProvider>
        <span data-testid="child">ok</span>
      </AnalyticsProvider>,
    );
    expect(getByTestId("child").textContent).toBe("ok");
  });

  it("loads nothing at all while no answer has been given", async () => {
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
  });

  it("loads nothing when the answer is denied (AC-3)", async () => {
    storeChoice("denied");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
  });

  it("initialises once when the answer is granted (AC-1)", async () => {
    storeChoice("granted");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({
        api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
        persistence: "localStorage+cookie",
      }),
    );
  });

  /**
   * Without a key there is nothing to send to, so the gate returns before it decides anything.
   * A granted answer must still not reach `init`, or a missing key would throw at load.
   */
  it("initialises nothing when no key is configured, even on a granted answer", async () => {
    env.NEXT_PUBLIC_POSTHOG_KEY = undefined;
    storeChoice("granted");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
  });

  /**
   * Withdrawal in the same tab (AC-4): stop sending first, then drop the distinct id, the cookies
   * and the storage keys. `reset(true)` rather than `reset()`, because only the true form clears
   * the device id as well.
   */
  it("stops collection and resets on withdrawal in the same tab (AC-4)", async () => {
    storeChoice("granted");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    posthog.__loaded = true;

    storeChoice("denied");
    await settle();
    expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.reset).toHaveBeenCalledWith(true);
  });

  /** A visitor who rejects from the start never loaded the library, so there is nothing to reset. */
  it("resets nothing when the library never loaded", async () => {
    storeChoice("denied");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  /**
   * The withdrawal leak (AC-4, proven on the deployment with a real key): a visitor accepts, then
   * withdraws by reloading with the consent cookie already set to denied, so this JS context never
   * calls `posthog.init` and `posthog.__loaded` is false the whole time. `posthog.reset()` and
   * `posthog.opt_out_capturing()` both guard on their own `__loaded` flag and do nothing at all
   * when it is false (verified against the posthog-js source, not assumed), so the accepted
   * session's leftover `ph_` prefixed `localStorage` keys and cookies survive unless the gate
   * clears them itself. `storeChoice("denied")` on a fresh render is exactly that fresh page load:
   * the mock's `__loaded` stays false for the whole test, the same as after a real reload.
   */
  it("clears leftover PostHog storage on a fresh page load even though the library never loaded here (AC-4)", async () => {
    // A previous, accepted session's write, already sitting in storage when this page loads.
    window.localStorage.setItem("ph_phc_test_posthog", '{"distinct_id":"abc"}');
    window.localStorage.setItem("unrelated_key", "keep-me");
    document.cookie = "ph_phc_test_posthog=abc; path=/";
    document.cookie = "unrelated_cookie=keep-me; path=/";

    storeChoice("denied");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();

    expect(posthog.reset).not.toHaveBeenCalled();
    expect(posthog.opt_out_capturing).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ph_phc_test_posthog")).toBeNull();
    expect(window.localStorage.getItem("unrelated_key")).toBe("keep-me");
    expect(document.cookie).not.toMatch(/ph_phc_test_posthog/);
    expect(document.cookie).toMatch(/unrelated_cookie=keep-me/);

    window.localStorage.removeItem("unrelated_key");
    document.cookie = "unrelated_cookie=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  /**
   * Re-accepting after a withdrawal in the same tab opts back in rather than initialising again.
   * A second `init` on a loaded library is what would double count every event from then on.
   */
  it("opts back in rather than initialising twice when consent returns", async () => {
    storeChoice("granted");
    render(<AnalyticsProvider>{null}</AnalyticsProvider>);
    await settle();
    posthog.__loaded = true;

    storeChoice("denied");
    await settle();
    storeChoice("granted");
    await settle();

    expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.init).toHaveBeenCalledTimes(1);
  });
});
