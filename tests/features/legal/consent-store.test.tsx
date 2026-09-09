// biome-ignore-all lint/suspicious/noDocumentCookie: these three suites drive the real jsdom cookie
// jar on purpose. The consent store reads `document.cookie` itself rather than taking it, so seeding
// the jar is what puts the component in the state under test; the Cookie Store API the rule prefers
// is not implemented in jsdom, and the app's own writes all go through the server action anyway.
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CONSENT_VERSION } from "@/features/legal/consent";
import { refreshConsent, useConsent, useMounted } from "@/features/legal/consent-store";

/**
 * The browser's live view of the consent cookie (spec 0015, AC-3, AC-4).
 *
 * Two invariants here are the kind that pass review and then hang the page. The snapshot must stay
 * referentially stable between notifications, because `useSyncExternalStore` compares with
 * `Object.is` and a fresh object per read loops forever. And the server snapshot must be `null`
 * whatever the cookie says, because the bar's server HTML is the hidden state: if the server ever
 * answered, a visitor who already chose would see the bar flash on every load, the same shape of
 * bug as the ICU grouping hydration failure.
 *
 * The store reads `document.cookie` rather than taking it, so these drive the real jsdom cookie
 * jar rather than a stub.
 */

/** What one subscriber sees, plus how many times it rendered. */
function Probe() {
  const consent = useConsent();
  const mounted = useMounted();
  return (
    <output data-testid="probe" data-mounted={String(mounted)}>
      {consent === null ? "none" : consent.choice}
    </output>
  );
}

const probe = () => screen.getByTestId("probe");

/** Writes the cookie the way the server action would, then wakes the store. */
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

afterEach(() => {
  clearCookie();
});

describe("useConsent (AC-3)", () => {
  it("reads no answer when nothing is stored", () => {
    render(<Probe />);
    expect(probe()).toHaveTextContent("none");
  });

  it("reads a stored answer of either kind after mount", () => {
    for (const choice of ["granted", "denied"] as const) {
      document.cookie = `sme24_consent=${choice}.${CONSENT_VERSION}; path=/`;
      const view = render(<Probe />);
      expect(probe(), choice).toHaveTextContent(choice);
      view.unmount();
      clearCookie();
    }
  });

  it("treats an answer stamped with another version as no answer (AC-3)", () => {
    document.cookie = `sme24_consent=granted.0; path=/`;
    render(<Probe />);
    expect(probe()).toHaveTextContent("none");
  });

  /**
   * The stability invariant. A store that built a fresh object per read would send React into an
   * infinite render loop here rather than settling; the test passing at all is the assertion, and
   * the identity check states what it is protecting.
   */
  it("keeps the snapshot referentially stable between reads, so React settles", () => {
    document.cookie = `sme24_consent=granted.${CONSENT_VERSION}; path=/`;
    const seen: unknown[] = [];
    function Recorder() {
      seen.push(useConsent());
      return null;
    }
    const view = render(<Recorder />);
    view.rerender(<Recorder />);
    view.rerender(<Recorder />);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const value of seen) expect(value).toBe(seen[0]);
  });
});

describe("refreshConsent (AC-4)", () => {
  it("wakes a subscriber when the answer is first written", () => {
    render(<Probe />);
    expect(probe()).toHaveTextContent("none");
    storeChoice("granted");
    expect(probe()).toHaveTextContent("granted");
  });

  it("flips a granted answer to denied in the same tab, without a reload", () => {
    storeChoice("granted");
    render(<Probe />);
    expect(probe()).toHaveTextContent("granted");
    storeChoice("denied");
    expect(probe()).toHaveTextContent("denied");
  });

  it("reopens the choice when the cookie is cleared, which is what the reopen control does", () => {
    storeChoice("granted");
    render(<Probe />);
    expect(probe()).toHaveTextContent("granted");
    clearCookie();
    expect(probe()).toHaveTextContent("none");
  });

  it("wakes every subscriber, so the bar and the analytics gate never disagree", () => {
    render(
      <div>
        <Probe />
        <output data-testid="second">
          <Second />
        </output>
      </div>,
    );
    storeChoice("granted");
    expect(probe()).toHaveTextContent("granted");
    expect(screen.getByTestId("second")).toHaveTextContent("granted");
  });

  it("drops a subscriber that unmounted, so a refresh after it never touches it", () => {
    const view = render(<Probe />);
    view.unmount();
    // No throw and no warning: the unsubscribe actually removed the listener.
    expect(() => act(() => refreshConsent())).not.toThrow();
  });
});

function Second() {
  const consent = useConsent();
  return <>{consent === null ? "none" : consent.choice}</>;
}

/**
 * `useConsent` cannot tell "no answer yet" from "not read yet": both are `null`. `useMounted` is
 * what lets the bar wait for the second, so a visitor who already chose never sees it flash.
 */
describe("useMounted (AC-5)", () => {
  it("is true once the component is mounted in the browser", () => {
    render(<Probe />);
    expect(probe()).toHaveAttribute("data-mounted", "true");
  });

  /**
   * The server never learns the answer, so it must render the hidden state whatever the jar holds.
   * The `renderToString` half is what jsdom alone cannot show: a `useMounted` that answered true on
   * the server, or a `useConsent` whose server snapshot read the cookie, would put the bar in the
   * static HTML of every prerendered page and flash it at a visitor who already chose.
   */
  it("is false on the server, and the server reads no answer, whatever is stored", async () => {
    const { renderToString } = await import("react-dom/server");
    document.cookie = `sme24_consent=granted.${CONSENT_VERSION}; path=/`;
    const html = renderToString(<Probe />);
    expect(html).toContain('data-mounted="false"');
    expect(html).toContain("none");
  });
});
