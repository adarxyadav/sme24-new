import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcceptTermsResult } from "@/features/legal/actions";
import { CURRENT_TERMS_VERSION } from "@/features/legal/terms";
import { navigationMock, renderWithIntl, stubRadixEnvironment } from "./helpers";

/**
 * The re consent dialog (spec 0015, AC-10).
 *
 * The property worth defending is that it cannot be waved away. What guarantees it is the
 * controlled `open` prop with no `onOpenChange`: Radix asks to close, nothing listens, and the
 * dialog stays. The three `preventDefault` handlers are a second layer that only starts mattering
 * the day someone adds an `onOpenChange` here, so these tests exercise the ways a user would
 * actually try — escape, a click outside, a close button — rather than asserting the handlers
 * exist. A dialog the user can dismiss is not a gate, and this file is what notices if it becomes
 * one.
 *
 * The gate is a render concern rather than a security boundary: it never runs for a server action
 * post. The boundary is the column grant, which leaves `terms_version` unwritable by anything but
 * `accept_terms()`, and `supabase/tests/accept_terms.test.sql` is what proves that half.
 */
const boundary = vi.hoisted(() => ({
  acceptTerms: vi.fn<() => Promise<AcceptTermsResult>>(),
  signOut: vi.fn(),
}));

vi.mock("@/features/legal/actions", () => ({ acceptTerms: boundary.acceptTerms }));
vi.mock("@/features/auth/actions", () => ({ signOut: boundary.signOut }));
vi.mock("next/navigation", () => navigationMock());

stubRadixEnvironment();

const { TermsGate } = await import("@/features/legal/ui/terms-gate");

const gate = () => screen.queryByTestId("terms-gate");
const acceptButton = () => screen.getByRole("button", { name: "Accept and continue" });

beforeEach(() => {
  boundary.acceptTerms.mockResolvedValue({ ok: true, data: { version: CURRENT_TERMS_VERSION } });
});

describe("what the gate shows (AC-10)", () => {
  it("opens over the page it is rendered on", () => {
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    expect(gate()).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("says what changed in this version, from the changelog", () => {
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    // The current version's entry: version 2 added the purchased contacts clause (spec 0018).
    expect(screen.getByText(/Version 2 adds a clause on purchased contacts/)).toBeInTheDocument();
  });

  it("links to the full terms in a new tab, so the dialog is not lost to reading them", () => {
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    const link = screen.getByRole("link", { name: "Read the full terms" });
    expect(link).toHaveAttribute("href", "/en/terms");
    expect(link).toHaveAttribute("target", "_blank");
    // Without this the new tab keeps a `window.opener` handle back to this one.
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders in German too", () => {
    renderWithIntl(<TermsGate locale="de-CH" />, "de-CH");
    expect(screen.getByText("Unsere Nutzungsbedingungen haben sich geändert")).toBeInTheDocument();
  });
});

/**
 * Every way a user would try to get past it without answering. Each of these closing would leave
 * someone using the product on terms they have not accepted, which is the exact thing AC-10 exists
 * to prevent.
 */
describe("the gate cannot be dismissed (AC-10)", () => {
  beforeEach(() => {
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
  });

  it("offers no close button to press", () => {
    expect(screen.queryByRole("button", { name: /close/i })).not.toBeInTheDocument();
  });

  it("stays open on escape", async () => {
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(gate()).toBeInTheDocument();
  });

  it("stays open on a press outside it", () => {
    // Dispatched rather than clicked through user-event: Radix marks the rest of the page
    // `pointer-events: none` while the dialog is open, which user-event refuses to click through,
    // so the event it actually listens for is sent directly.
    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true }),
    );
    expect(gate()).toBeInTheDocument();
  });

  it("offers exactly two ways out: accept, or sign out", () => {
    expect(acceptButton()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out instead" })).toBeInTheDocument();
  });
});

describe("accepting (AC-10)", () => {
  it("records the acceptance and closes on the spot", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    await user.click(acceptButton());
    expect(boundary.acceptTerms).toHaveBeenCalled();
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
  });

  it("takes no version from the page, so the browser cannot name what it accepts", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    await user.click(acceptButton());
    // The action reads `CURRENT_TERMS_VERSION` itself; the client is accepting what this build
    // rendered, so a version travelling from the browser would let it accept one it never showed.
    expect(boundary.acceptTerms).toHaveBeenCalledWith();
  });

  it("stays open and says so when the write fails, rather than letting the user through", async () => {
    boundary.acceptTerms.mockResolvedValue({ ok: false, error: "unexpected" });
    const user = userEvent.setup();
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    await user.click(acceptButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We could not record your acceptance. Please try again.");
    expect(gate()).toBeInTheDocument();
  });

  it("lets a failed acceptance be retried, clearing the previous message", async () => {
    boundary.acceptTerms.mockResolvedValueOnce({ ok: false, error: "unexpected" });
    const user = userEvent.setup();
    renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    await user.click(acceptButton());
    await screen.findByRole("alert");
    await user.click(acceptButton());
    await waitFor(() => expect(gate()).not.toBeInTheDocument());
  });
});

/**
 * Sign out is a plain form post rather than a click handler, so it works whether or not the accept
 * transition is in flight: someone who does not accept is never stuck behind their own pending
 * request.
 */
describe("declining (AC-10)", () => {
  it("signs out through a form post carrying the locale", () => {
    const { container } = renderWithIntl(<TermsGate locale="en-CH" />, "en-CH");
    const decline = screen.getByRole("button", { name: "Sign out instead" });
    expect(decline).toHaveAttribute("type", "submit");
    const form = decline.closest("form");
    expect(form).not.toBeNull();
    expect(container.ownerDocument.querySelector('input[name="locale"]')).toHaveValue("en-CH");
  });
});
