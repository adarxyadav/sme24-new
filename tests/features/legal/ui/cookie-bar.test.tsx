// biome-ignore-all lint/suspicious/noDocumentCookie: these three suites drive the real jsdom cookie
// jar on purpose. The consent store reads `document.cookie` itself rather than taking it, so seeding
// the jar is what puts the component in the state under test; the Cookie Store API the rule prefers
// is not implemented in jsdom, and the app's own writes all go through the server action anyway.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetConsentResult } from "@/features/legal/actions";
import { CONSENT_VERSION } from "@/features/legal/consent";
import { navigationMock, renderWithIntl, stubResizeObserver } from "./helpers";

/**
 * The cookie bar (spec 0015, AC-1, AC-2, AC-5, AC-5b).
 *
 * The four measurable properties of AC-2 are the point of this file: accept and reject are the
 * same component, the same variant, the same size, side by side, and neither is preselected. A
 * design that nudged towards accepting would be a consent that is not freely given, and the only
 * way to keep that honest over time is to assert the two buttons against each other rather than
 * to describe them.
 *
 * The other half is what the bar does **not** render. It shows nothing at all until it is mounted
 * and finds no current answer, because a visible default would flash on every load for a visitor
 * who already chose. jsdom cannot see a flash, so what is asserted is the rule underneath it: with
 * a stored answer, the bar is simply not in the tree.
 */
const boundary = vi.hoisted(() => ({
  setConsent: vi.fn<(choice: string) => Promise<SetConsentResult>>(),
}));

vi.mock("@/features/legal/actions", () => ({ setConsent: boundary.setConsent }));
vi.mock("next/navigation", () => navigationMock());

stubResizeObserver();

const { CookieBar } = await import("@/features/legal/ui/cookie-bar");

const bar = () => screen.queryByTestId("cookie-bar");
const accept = () => screen.getByRole("button", { name: "Accept" });
const reject = () => screen.getByRole("button", { name: "Reject" });

/** Writes the cookie the way a previous visit would have left it. */
function storeChoice(choice: "granted" | "denied") {
  document.cookie = `sme24_consent=${choice}.${CONSENT_VERSION}; path=/`;
}

beforeEach(() => {
  document.cookie = "sme24_consent=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  document.documentElement.style.removeProperty("--consent-bar-height");
  boundary.setConsent.mockResolvedValue({ ok: true });
});

describe("what the bar shows (AC-1, AC-5)", () => {
  it("appears for a visitor who has not answered", () => {
    renderWithIntl(<CookieBar />, "en-CH");
    expect(bar()).toBeInTheDocument();
  });

  it("stays away for a visitor who already accepted, so it never flashes on a second load", () => {
    storeChoice("granted");
    renderWithIntl(<CookieBar />, "en-CH");
    expect(bar()).not.toBeInTheDocument();
  });

  it("stays away for a visitor who already rejected: a rejection is an answer (AC-3)", () => {
    storeChoice("denied");
    renderWithIntl(<CookieBar />, "en-CH");
    expect(bar()).not.toBeInTheDocument();
  });

  it("appears again once the stored answer is stamped with an older version", () => {
    // Bumping `CONSENT_VERSION` is the only way to ask a past visitor about a new purpose.
    document.cookie = "sme24_consent=granted.0; path=/";
    renderWithIntl(<CookieBar />, "en-CH");
    expect(bar()).toBeInTheDocument();
  });

  it("is a labelled region rather than a dialog, so it never traps focus before anyone reads it", () => {
    renderWithIntl(<CookieBar />, "en-CH");
    expect(screen.getByRole("region", { name: "Cookies and analytics" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("links to the cookies page so the visitor can read what is stored before answering", () => {
    renderWithIntl(<CookieBar />, "en-CH");
    expect(screen.getByRole("link", { name: "What we store" })).toHaveAttribute(
      "href",
      "/en/cookies",
    );
  });

  it("renders in German with the German copy and the German slug", () => {
    renderWithIntl(<CookieBar />, "de-CH");
    expect(bar()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ablehnen" })).toBeInTheDocument();
  });
});

/**
 * AC-2 in full. Each property is asserted by comparing the two buttons rather than by naming a
 * class, so a redesign that changes both together stays green and one that privileges accepting
 * fails.
 */
describe("accept and reject are equals (AC-2)", () => {
  beforeEach(() => {
    renderWithIntl(<CookieBar />, "en-CH");
  });

  it("offers both as real buttons", () => {
    expect(accept()).toBeInTheDocument();
    expect(reject()).toBeInTheDocument();
  });

  it("renders them as the same element with the same type", () => {
    expect(reject().tagName).toBe(accept().tagName);
    expect(reject().getAttribute("type")).toBe(accept().getAttribute("type"));
  });

  it("gives them the same variant and size, so neither is visually louder", () => {
    // The shadcn Button stamps its variant and size into the class list, so comparing the two
    // catches a change that made one primary without hard coding what the variant is today.
    expect(reject().className).toBe(accept().className);
    expect(reject().getAttribute("data-variant")).toBe(accept().getAttribute("data-variant"));
  });

  it("preselects neither: no default, no autofocus, no aria-pressed", () => {
    for (const button of [accept(), reject()]) {
      expect(button).not.toHaveAttribute("autofocus");
      expect(button).not.toHaveAttribute("aria-pressed");
      expect(button).not.toHaveAttribute("data-state", "on");
    }
    expect(document.activeElement).toBe(document.body);
  });

  it("puts them side by side in one group, reject first in the DOM order", () => {
    expect(reject().parentElement).toBe(accept().parentElement);
    // Reject leads the pair, so the keyboard reaches the refusal at least as easily as the accept.
    expect(reject().compareDocumentPosition(accept())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("reaches both by keyboard in that order", async () => {
    const user = userEvent.setup();
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(reject());
    await user.tab();
    expect(document.activeElement).toBe(accept());
  });
});

describe("answering (AC-1, AC-3, AC-4)", () => {
  it("stores a rejection and closes the bar", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CookieBar />, "en-CH");
    await user.click(reject());
    expect(boundary.setConsent).toHaveBeenCalledWith("denied");
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it("stores an acceptance and closes the bar", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CookieBar />, "en-CH");
    await user.click(accept());
    expect(boundary.setConsent).toHaveBeenCalledWith("granted");
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
  });

  it("writes the cookie through the action, never through document.cookie in the browser", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CookieBar />, "en-CH");
    await user.click(accept());
    // A first party cookie written by a POST stays out of a third party script's reach, and the
    // reject path then works without JavaScript having to set anything.
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(document.cookie).not.toContain("sme24_consent");
  });

  it("keeps the bar open when the write fails, so the answer is never silently lost", async () => {
    boundary.setConsent.mockResolvedValue({ ok: false, error: "validation" });
    const user = userEvent.setup();
    renderWithIntl(<CookieBar />, "en-CH");
    await user.click(accept());
    await waitFor(() => expect(boundary.setConsent).toHaveBeenCalled());
    expect(bar()).toBeInTheDocument();
  });

  it("records one answer per click, however fast the second arrives", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CookieBar />, "en-CH");
    await user.click(accept());
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(boundary.setConsent).toHaveBeenCalledTimes(1);
  });
});

/**
 * The bar is fixed to the bottom and the signed in sidebar is `h-svh`, so without this variable
 * the bar sits on top of the sidebar footer and the user menu underneath it cannot be clicked at
 * all (AC-5b).
 */
describe("the height variable (AC-5b)", () => {
  it("publishes the bar's height while it is showing", () => {
    renderWithIntl(<CookieBar />, "en-CH");
    expect(document.documentElement.style.getPropertyValue("--consent-bar-height")).not.toBe("");
  });

  it("publishes nothing for a visitor who already answered", () => {
    storeChoice("granted");
    renderWithIntl(<CookieBar />, "en-CH");
    expect(document.documentElement.style.getPropertyValue("--consent-bar-height")).toBe("");
  });

  it("removes the variable once the bar is answered and gone", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CookieBar />, "en-CH");
    await user.click(accept());
    await waitFor(() => expect(bar()).not.toBeInTheDocument());
    expect(document.documentElement.style.getPropertyValue("--consent-bar-height")).toBe("");
  });

  it("removes the variable when the bar unmounts, so no page keeps reserving the space", () => {
    const view = renderWithIntl(<CookieBar />, "en-CH");
    view.unmount();
    expect(document.documentElement.style.getPropertyValue("--consent-bar-height")).toBe("");
  });
});
