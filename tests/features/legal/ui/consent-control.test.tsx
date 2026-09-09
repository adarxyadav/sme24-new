// biome-ignore-all lint/suspicious/noDocumentCookie: these three suites drive the real jsdom cookie
// jar on purpose. The consent store reads `document.cookie` itself rather than taking it, so seeding
// the jar is what puts the component in the state under test; the Cookie Store API the rule prefers
// is not implemented in jsdom, and the app's own writes all go through the server action anyway.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SetConsentResult } from "@/features/legal/actions";
import { CONSENT_VERSION } from "@/features/legal/consent";
import { navigationMock, renderWithIntl } from "./helpers";

/**
 * The consent control on the cookies page (spec 0015, AC-4, AC-8b).
 *
 * This is the page a visitor reaches to change their mind, so the property that matters is that
 * both directions work from every starting point: someone who rejected can accept, someone who
 * accepted can reject, and either can put the question back to the bar. The bar itself only ever
 * appears to a visitor with no answer, so without this control a rejection would be permanent.
 *
 * The control also has to state the current answer truthfully before it has read the cookie, since
 * the page around it is statically prerendered (AC-5): the honest server rendering is "not
 * answered yet", never a guess.
 */
const boundary = vi.hoisted(() => ({
  setConsent: vi.fn<(choice: string) => Promise<SetConsentResult>>(),
  clearConsent: vi.fn<() => Promise<SetConsentResult>>(),
}));

vi.mock("@/features/legal/actions", () => ({
  setConsent: boundary.setConsent,
  clearConsent: boundary.clearConsent,
}));
vi.mock("next/navigation", () => navigationMock());

const { ConsentControl } = await import("@/features/legal/ui/consent-control");

const accept = () => screen.getByRole("button", { name: "Accept analytics" });
const reject = () => screen.getByRole("button", { name: "Reject analytics" });
const reopen = () => screen.queryByRole("button", { name: "Change your choice" });
const status = () => screen.getByText(/You (accepted|rejected|have not answered)/);

function storeChoice(choice: "granted" | "denied") {
  document.cookie = `sme24_consent=${choice}.${CONSENT_VERSION}; path=/`;
}

/**
 * The mocked actions write the cookie the way the real ones do through `cookies()`, because the
 * component's own `refreshConsent` runs the moment the action resolves: a test that wrote the
 * cookie afterwards would be racing the re-read it is trying to observe.
 */
beforeEach(() => {
  document.cookie = "sme24_consent=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  boundary.setConsent.mockImplementation(async (choice) => {
    storeChoice(choice as "granted" | "denied");
    return { ok: true };
  });
  boundary.clearConsent.mockImplementation(async () => {
    document.cookie = "sme24_consent=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    return { ok: true };
  });
});

describe("what it states (AC-8b)", () => {
  it("states no answer when nothing is stored", () => {
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(status()).toHaveTextContent("You have not answered yet.");
  });

  it("states the stored acceptance", () => {
    storeChoice("granted");
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(status()).toHaveTextContent("You accepted analytics.");
  });

  it("states the stored rejection, so a rejection is visibly an answer", () => {
    storeChoice("denied");
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(status()).toHaveTextContent("You rejected analytics.");
  });

  it("states no answer for a stored choice stamped with an older version", () => {
    document.cookie = "sme24_consent=granted.0; path=/";
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(status()).toHaveTextContent("You have not answered yet.");
  });

  it("announces the line politely, since it changes without a navigation", () => {
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(status()).toHaveAttribute("aria-live", "polite");
  });

  it("renders in German too", () => {
    storeChoice("granted");
    renderWithIntl(<ConsentControl />, "de-CH");
    expect(screen.getByText("Sie haben der Analyse zugestimmt.")).toBeInTheDocument();
  });
});

/**
 * AC-8b's point: the control offers both answers whatever the cookie currently says, so no answer
 * is ever a dead end. The reopen control only appears once there is something to reopen.
 */
describe("what it offers (AC-8b)", () => {
  it("offers both answers to a visitor who has not answered, and no reopen", () => {
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(accept()).toBeInTheDocument();
    expect(reject()).toBeInTheDocument();
    expect(reopen()).not.toBeInTheDocument();
  });

  it("still offers both answers plus reopen to a visitor who accepted", () => {
    storeChoice("granted");
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(accept()).toBeInTheDocument();
    expect(reject()).toBeInTheDocument();
    expect(reopen()).toBeInTheDocument();
  });

  it("still offers both answers plus reopen to a visitor who rejected", () => {
    storeChoice("denied");
    renderWithIntl(<ConsentControl />, "en-CH");
    expect(accept()).toBeInTheDocument();
    expect(reject()).toBeInTheDocument();
    expect(reopen()).toBeInTheDocument();
  });
});

describe("changing the answer (AC-4)", () => {
  it("withdraws consent: an acceptance flips to a rejection and the line follows", async () => {
    storeChoice("granted");
    const user = userEvent.setup();
    renderWithIntl(<ConsentControl />, "en-CH");
    await user.click(reject());
    expect(boundary.setConsent).toHaveBeenCalledWith("denied");
    await waitFor(() => expect(status()).toHaveTextContent("You rejected analytics."));
  });

  it("lets a visitor who rejected accept later, without clearing their browser", async () => {
    storeChoice("denied");
    const user = userEvent.setup();
    renderWithIntl(<ConsentControl />, "en-CH");
    await user.click(accept());
    expect(boundary.setConsent).toHaveBeenCalledWith("granted");
    await waitFor(() => expect(status()).toHaveTextContent("You accepted analytics."));
  });

  it("reopens the question by clearing the cookie, which brings the bar back", async () => {
    storeChoice("granted");
    const user = userEvent.setup();
    renderWithIntl(<ConsentControl />, "en-CH");
    await user.click(reopen() as HTMLElement);
    expect(boundary.clearConsent).toHaveBeenCalled();
    await waitFor(() => expect(status()).toHaveTextContent("You have not answered yet."));
  });

  it("leaves the stated answer alone when the write fails", async () => {
    boundary.setConsent.mockResolvedValue({ ok: false, error: "validation" });
    storeChoice("granted");
    const user = userEvent.setup();
    renderWithIntl(<ConsentControl />, "en-CH");
    await user.click(reject());
    await waitFor(() => expect(boundary.setConsent).toHaveBeenCalled());
    expect(status()).toHaveTextContent("You accepted analytics.");
  });
});
