import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailActionResult } from "@/features/emails/actions";
import { RetryButton } from "@/features/emails/ui/retry-button";
import { DELIVERY_ID, de, renderWithIntl } from "./helpers";

/**
 * The retry button of a failed delivery (spec 0006, AC-10): it calls the action with the row id,
 * shows the run id in a success toast and refreshes the page; every action error becomes its own
 * error toast without a refresh; while the action runs the button is disabled and busy. The server
 * action, the toaster and the router are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  retryDelivery: vi.fn<() => Promise<EmailActionResult>>(),
  success: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/features/emails/actions", () => ({ retryDelivery: boundary.retryDelivery }));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: boundary.error } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "de-CH" }),
  usePathname: () => "/de/admin/emails/x",
  useSearchParams: () => new URLSearchParams(),
}));

const ERRORS = [
  ["forbidden", "forbidden"],
  ["invalid", "invalid"],
  ["not_retryable", "notRetryable"],
  ["webhook_unset", "webhookUnset"],
  ["trigger_unavailable", "triggerUnavailable"],
  ["trigger_failed", "triggerFailed"],
] as const;

beforeEach(() => {
  boundary.retryDelivery.mockResolvedValue({ ok: true, data: { runId: "run_1" } });
});

describe("RetryButton (AC-10)", () => {
  it("retries the delivery, toasts the run id and refreshes the page", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RetryButton deliveryId={DELIVERY_ID} />);
    await user.click(screen.getByRole("button", { name: de.emails.actions.retry }));
    expect(boundary.retryDelivery).toHaveBeenCalledWith({ deliveryId: DELIVERY_ID });
    await waitFor(() =>
      expect(boundary.success).toHaveBeenCalledWith("Erneuter Versand gestartet (Lauf run_1)"),
    );
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
    expect(boundary.error).not.toHaveBeenCalled();
  });

  it.each(ERRORS)("toasts the %s error and does not refresh", async (error, key) => {
    boundary.retryDelivery.mockResolvedValue({ ok: false, error });
    const user = userEvent.setup();
    renderWithIntl(<RetryButton deliveryId={DELIVERY_ID} />);
    await user.click(screen.getByRole("button", { name: de.emails.actions.retry }));
    await waitFor(() => expect(boundary.error).toHaveBeenCalledWith(de.emails.toasts[key]));
    expect(boundary.success).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("is disabled and busy with a progress label while the action runs, then usable again", async () => {
    let finish: (result: EmailActionResult) => void = () => {};
    boundary.retryDelivery.mockReturnValue(
      new Promise<EmailActionResult>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithIntl(<RetryButton deliveryId={DELIVERY_ID} />);
    await user.click(screen.getByRole("button", { name: de.emails.actions.retry }));
    const busy = await screen.findByRole("button", { name: de.emails.actions.retrying });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");

    finish({ ok: true, data: { runId: "run_2" } });
    const idle = await screen.findByRole("button", { name: de.emails.actions.retry });
    expect(idle).toBeEnabled();
    expect(idle).toHaveAttribute("aria-busy", "false");
  });

  it("is reachable by keyboard and triggers on Enter", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RetryButton deliveryId={DELIVERY_ID} />);
    await user.tab();
    expect(screen.getByRole("button", { name: de.emails.actions.retry })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(boundary.retryDelivery).toHaveBeenCalledTimes(1);
  });
});
