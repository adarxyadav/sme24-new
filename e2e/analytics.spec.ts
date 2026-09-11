import { expect, type Page, test } from "@playwright/test";
import { SEED_USERS, seedPassword, signIn } from "./helpers";

/**
 * The browser event and the consent line it sits behind (spec 0017, AC-4, AC-6).
 *
 * The claim under test is the negative one: before the visitor answers the cookie bar, neither a
 * `benchmark.viewed` event nor any identifier leaves the browser. That cannot be proven in jsdom —
 * it needs a real cookie jar, a real deferred import and a real network — so it lives here rather
 * than beside the unit suite.
 *
 * The positive half (the event fires once after accepting) is asserted only when a PostHog key is
 * actually configured. With no key the gate initialises nothing, so a bare assertion would pass on
 * absence rather than on the event working, which is the shape of the AC-4 bug that once survived
 * the whole workflow and only failed on a deployment (see `consent.spec.ts`). Skip loudly instead.
 */

const CONSENT_COOKIE = "sme24_consent";
/** Must equal `CONSENT_VERSION` in `src/features/legal/consent.ts`; a Vitest test pins that value. */
const CONSENT_VERSION = "1";

const bar = (page: Page) => page.getByTestId("cookie-bar");
const accept = (page: Page) => bar(page).getByRole("button", { name: /accept|zustimmen/i });

/** Every request to the PostHog host, whatever key is configured. */
function watchPostHog(page: Page) {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (/posthog\.com|posthog\.io/.test(request.url())) hits.push(request.url());
  });
  return hits;
}

/** The identifier storage PostHog writes: `ph_` prefixed keys and cookies alike (AC-4). */
async function identifiers(page: Page) {
  const keys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((key) => key.startsWith("ph_")),
  );
  const cookies = (await page.context().cookies())
    .filter((cookie) => cookie.name.startsWith("ph_"))
    .map((cookie) => cookie.name);
  return [...keys, ...cookies];
}

// Every test here signs in as a seeded user, and `signIn` casts the password to a string, so an
// unset `E2E_SEED_PASSWORD` submits an empty one and the sign in redirect never comes: the suite
// hangs on `waitForURL` rather than skipping. Every other spec that signs in guards on
// `seedPassword` too, either alone (`design`, `emails`, `enquiries`, `roles`, `localization`,
// `auth`) or together with `dbAvailable` (`ops-admin`, `experts`, `legal`).
test.skip(!seedPassword, "E2E_SEED_PASSWORD is not set; seeded users are unavailable");

test.describe("benchmark.viewed", () => {
  test("no event and no identifier before the visitor answers the bar (AC-4, AC-6)", async ({
    page,
  }) => {
    const hits = watchPostHog(page);
    await signIn(page, SEED_USERS.client);

    await page.goto("/en/app");
    // The bar is the proof that no answer is stored yet; the dashboard renders behind it.
    await expect(bar(page)).toBeVisible();
    // Give the deferred `posthog-js` import and any mount effect time to fire before asserting
    // silence: asserting immediately would pass on timing rather than on the gate.
    await page.waitForTimeout(1_000);

    expect(hits).toEqual([]);
    expect(await identifiers(page)).toEqual([]);
  });

  test("a denied answer keeps the event away for good (AC-6)", async ({ page, baseURL }) => {
    const hits = watchPostHog(page);
    await signIn(page, SEED_USERS.client);
    await page
      .context()
      .addCookies([{ name: CONSENT_COOKIE, value: `denied.${CONSENT_VERSION}`, url: baseURL }]);

    await page.goto("/en/app");
    await expect(bar(page)).toBeHidden();
    await page.waitForTimeout(1_000);

    expect(hits).toEqual([]);
    expect(await identifiers(page)).toEqual([]);
  });

  test("after accepting, the dashboard sends benchmark.viewed once (AC-6)", async ({ page }) => {
    const hits = watchPostHog(page);
    await signIn(page, SEED_USERS.client);
    await page.goto("/en/app");
    await expect(bar(page)).toBeVisible();
    await accept(page).click();
    await expect(bar(page)).toBeHidden();
    await page.waitForLoadState("networkidle");

    // Without a real key the gate never calls `posthog.init`, so nothing can capture and the
    // assertions below would pass on absence. That is not evidence, so say so and stop.
    const initialised = await page.evaluate(() =>
      Object.keys(window.localStorage).some((key) => key.startsWith("ph_")),
    );
    test.skip(
      !initialised,
      "PostHog never initialised, so no browser event can be observed: set NEXT_PUBLIC_POSTHOG_KEY to run this.",
    );

    // The event only exists on a dashboard that actually rendered a snapshot; a client without one
    // is a valid state of the app, not a failure of this event.
    const segment = page.locator("[data-benchmark-state='ready']");
    test.skip(
      (await segment.count()) === 0,
      "this client has no ready benchmark snapshot, so there is no view to report.",
    );

    await page.waitForTimeout(1_000);
    const captures = hits.filter((url) => /\/e\/|\/capture\//.test(url));
    expect(captures.length).toBeGreaterThan(0);
  });
});
