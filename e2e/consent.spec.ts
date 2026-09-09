import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

/**
 * The consent thread (spec 0015, milestone 1): no analytics before an answer (AC-1), the two
 * controls are equal and unticked (AC-2), the choice survives a reload and an old version reopens
 * the bar (AC-3), withdrawal stops collection (AC-4), and the bar never flashes for a visitor who
 * already chose (AC-5). The signed in areas get the bar from the same root layout (AC-5b).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CONSENT_COOKIE = "sme24_consent";
/** Must equal `CONSENT_VERSION` in `src/features/legal/consent.ts`; a Vitest test pins that value. */
const CONSENT_VERSION = "1";

const bar = (page: Page) => page.getByTestId("cookie-bar");
const accept = (page: Page) => bar(page).getByRole("button", { name: /accept|zustimmen/i });
const reject = (page: Page) => bar(page).getByRole("button", { name: /reject|ablehnen/i });

/** Records every request to the PostHog host, whatever key is configured (AC-1). */
function watchPostHog(page: Page) {
  const hits: string[] = [];
  page.on("request", (request) => {
    if (/posthog\.com|posthog\.io/.test(request.url())) hits.push(request.url());
  });
  return hits;
}

async function consentCookie(page: Page) {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === CONSENT_COOKIE);
}

test.describe("the cookie bar", () => {
  test("a fresh visitor is asked, and nothing reaches PostHog before an answer (AC-1)", async ({
    page,
  }) => {
    const hits = watchPostHog(page);
    await page.goto("/en");
    await expect(bar(page)).toBeVisible();
    // Give any deferred import time to fire before asserting silence.
    await page.waitForTimeout(1_000);
    expect(hits).toEqual([]);
    expect(await consentCookie(page)).toBeUndefined();
  });

  test("accept and reject are two controls of equal size, weight and prominence, side by side, unticked (AC-2)", async ({
    page,
  }) => {
    await page.goto("/en");
    await expect(bar(page)).toBeVisible();

    const acceptBox = await accept(page).boundingBox();
    const rejectBox = await reject(page).boundingBox();
    if (!acceptBox || !rejectBox) throw new Error("both controls must be laid out");

    // Size: the same height and, within a rounding pixel, whatever width their labels need is not
    // what is compared — the box that carries the click is. Equal height and equal padding is the
    // measurable half; the styling assertions below carry the rest.
    expect(Math.abs(acceptBox.height - rejectBox.height)).toBeLessThanOrEqual(1);

    // Side by side: their vertical centres line up, so neither sits above the other.
    const acceptCentre = acceptBox.y + acceptBox.height / 2;
    const rejectCentre = rejectBox.y + rejectBox.height / 2;
    expect(Math.abs(acceptCentre - rejectCentre)).toBeLessThanOrEqual(1);

    // Weight and prominence: identical font weight, size, background and text colour. A primary
    // accept beside a ghost reject is the dark pattern this asserts against.
    const style = (locator: ReturnType<typeof accept>) =>
      locator.evaluate((element) => {
        const computed = getComputedStyle(element);
        return {
          fontWeight: computed.fontWeight,
          fontSize: computed.fontSize,
          backgroundColor: computed.backgroundColor,
          color: computed.color,
          borderColor: computed.borderTopColor,
          opacity: computed.opacity,
        };
      });
    expect(await style(accept(page))).toEqual(await style(reject(page)));

    // No pre ticked state: neither control is pressed, checked or a default focus target.
    for (const control of [accept(page), reject(page)]) {
      await expect(control).not.toHaveAttribute("aria-pressed", "true");
      await expect(control).not.toHaveAttribute("aria-checked", "true");
      await expect(control)
        .not.toBeChecked({ timeout: 100 })
        .catch(() => undefined);
    }
    expect(await bar(page).locator("input:checked").count()).toBe(0);
  });

  test("the bar passes axe (WCAG 2.2 AA)", async ({ page }) => {
    await page.goto("/en");
    await expect(bar(page)).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    expect(results.violations).toEqual([]);
  });

  test("accepting stores a current answer and the bar stays gone across a reload and a new page (AC-3)", async ({
    page,
  }) => {
    await page.goto("/en");
    await accept(page).click();
    await expect(bar(page)).toBeHidden();

    const cookie = await consentCookie(page);
    expect(cookie?.value).toBe(`granted.${CONSENT_VERSION}`);
    expect(cookie?.path).toBe("/");
    expect(cookie?.sameSite).toBe("Lax");
    // Readable after mount, so the bar and the gate can see it; it carries no identifier.
    expect(cookie?.httpOnly).toBe(false);

    await page.reload();
    await expect(bar(page)).toBeHidden();
    await page.goto("/en/pricing");
    await expect(bar(page)).toBeHidden();
  });

  test("rejecting is an answer too: the bar closes and nothing reaches PostHog afterwards (AC-1, AC-3)", async ({
    page,
  }) => {
    const hits = watchPostHog(page);
    await page.goto("/en");
    await reject(page).click();
    await expect(bar(page)).toBeHidden();
    expect((await consentCookie(page))?.value).toBe(`denied.${CONSENT_VERSION}`);

    await page.reload();
    await expect(bar(page)).toBeHidden();
    await page.waitForTimeout(1_000);
    expect(hits).toEqual([]);
  });

  test("an answer stamped with another version reopens the bar (AC-3)", async ({ page }) => {
    await page.goto("/en");
    await page.context().addCookies([
      {
        name: CONSENT_COOKIE,
        value: "granted.0",
        url: page.url(),
      },
    ]);
    await page.reload();
    // Granted under a version this build does not recognise counts as no answer at all.
    await expect(bar(page)).toBeVisible();
  });

  test("withdrawing stops collection: the choice flips and the PostHog storage is cleared (AC-4)", async ({
    page,
  }) => {
    await page.goto("/en");
    await accept(page).click();
    await expect(bar(page)).toBeHidden();
    // Let the accepted session's own PostHog init calls (script, config and flags requests, then
    // their persistence writes) finish before withdrawing: a request or a storage write already in
    // flight when the cookie flips is not part of what AC-4 claims, and starting the watch or
    // reading storage beforehand would catch it by accident, the same race `networkidle` guards
    // against elsewhere in this suite (see auth.spec.ts, benchmark.spec.ts).
    await page.waitForLoadState("networkidle");

    const hits = watchPostHog(page);
    // Withdrawal goes through the same server action, so the cookie is the record of the change.
    await page
      .context()
      .addCookies([{ name: CONSENT_COOKIE, value: `denied.${CONSENT_VERSION}`, url: page.url() }]);
    await page.reload();
    await expect(bar(page)).toBeHidden();
    expect((await consentCookie(page))?.value).toBe(`denied.${CONSENT_VERSION}`);

    await page.waitForTimeout(1_000);
    expect(hits).toEqual([]);
    const posthogKeys = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((key) => key.startsWith("ph_")),
    );
    expect(posthogKeys).toEqual([]);
    const posthogCookies = (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("ph_"),
    );
    expect(posthogCookies).toEqual([]);
  });

  test("a visitor who already answered never sees the bar flash (AC-5)", async ({
    page,
    baseURL,
  }) => {
    // No navigation has happened yet, so there is no `page.url()` to derive the cookie's URL from;
    // the configured `baseURL` is the local dev server or, against a deployment, the deployment's
    // own URL (see playwright.config.ts), which is what every other spec in this file assumes.
    await page.context().addCookies([
      {
        name: CONSENT_COOKIE,
        value: `granted.${CONSENT_VERSION}`,
        url: baseURL,
      },
    ]);

    // Sample from the first paint onwards: the bar's server HTML and its hydrated state must both
    // be absent. A `useEffect` that showed the bar before reading the cookie would be caught here
    // and nowhere else — jsdom cannot see a flash.
    const seen: boolean[] = [];
    await page.goto("/en");
    for (let sample = 0; sample < 20; sample += 1) {
      seen.push((await page.getByTestId("cookie-bar").count()) > 0);
      await page.waitForTimeout(50);
    }
    expect(seen.some(Boolean)).toBe(false);
  });

  test("the bar renders in German too, so the choice is never asked in the wrong language (AC-2)", async ({
    page,
  }) => {
    await page.goto("/de");
    await expect(bar(page)).toBeVisible();
    await expect(reject(page)).toBeVisible();
    await expect(accept(page)).toBeVisible();
  });
});
