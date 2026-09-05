import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailActionResult } from "@/features/emails/actions";
import { TestButtons } from "@/features/emails/ui/test-buttons";
import { de, en, renderWithIntl } from "./helpers";

/**
 * The two configuration checks of `/admin/emails` (spec 0006, AC-10): each button calls its own
 * action, shows the run id in a toast, tells the operator when the Slack webhook is unset, and
 * only the clicked button goes busy. The two server actions and the toaster are the boundaries.
 */
const boundary = vi.hoisted(() => ({
  sendTestEmail: vi.fn<() => Promise<EmailActionResult>>(),
  sendTestAlert: vi.fn<() => Promise<EmailActionResult>>(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/emails/actions", () => ({
  retryDelivery: vi.fn(),
  sendTestEmail: boundary.sendTestEmail,
  sendTestAlert: boundary.sendTestAlert,
}));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: boundary.error } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  useParams: () => ({ locale: "de-CH" }),
  usePathname: () => "/de/admin/emails",
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => {
  boundary.sendTestEmail.mockResolvedValue({ ok: true, data: { runId: "run_email" } });
  boundary.sendTestAlert.mockResolvedValue({ ok: true, data: { runId: "run_alert" } });
});

describe("TestButtons (AC-10)", () => {
  it("is a region named by its heading with the two buttons, in both languages", () => {
    renderWithIntl(<TestButtons />);
    expect(screen.getByRole("region", { name: de.emails.actions.testHeading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: de.emails.actions.testEmail })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: de.emails.actions.testAlert })).toBeInTheDocument();
  });

  it("names the buttons in English too", () => {
    renderWithIntl(<TestButtons />, "en-CH");
    expect(screen.getByRole("button", { name: en.emails.actions.testEmail })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en.emails.actions.testAlert })).toBeInTheDocument();
  });

  it("sends the test email and toasts the run id", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TestButtons />);
    await user.click(screen.getByRole("button", { name: de.emails.actions.testEmail }));
    expect(boundary.sendTestEmail).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(boundary.success).toHaveBeenCalledWith("Test E-Mail gestartet (Lauf run_email)"),
    );
    expect(boundary.sendTestAlert).not.toHaveBeenCalled();
  });

  it("sends the test alert and toasts the run id", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TestButtons />);
    await user.click(screen.getByRole("button", { name: de.emails.actions.testAlert }));
    expect(boundary.sendTestAlert).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(boundary.success).toHaveBeenCalledWith("Test Alarm gestartet (Lauf run_alert)"),
    );
  });

  it("tells the operator when the Slack webhook is not set in this environment", async () => {
    boundary.sendTestAlert.mockResolvedValue({ ok: false, error: "webhook_unset" });
    const user = userEvent.setup();
    renderWithIntl(<TestButtons />);
    await user.click(screen.getByRole("button", { name: de.emails.actions.testAlert }));
    await waitFor(() => expect(boundary.error).toHaveBeenCalledWith(de.emails.toasts.webhookUnset));
    expect(boundary.success).not.toHaveBeenCalled();
  });

  it("marks only the clicked button busy while its action runs", async () => {
    let finish: (result: EmailActionResult) => void = () => {};
    boundary.sendTestEmail.mockReturnValue(
      new Promise<EmailActionResult>((resolve) => {
        finish = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithIntl(<TestButtons />);
    const email = screen.getByRole("button", { name: de.emails.actions.testEmail });
    const alert = screen.getByRole("button", { name: de.emails.actions.testAlert });
    await user.click(email);
    await waitFor(() => expect(email).toBeDisabled());
    expect(email).toHaveAttribute("aria-busy", "true");
    expect(alert).toBeEnabled();
    expect(alert).toHaveAttribute("aria-busy", "false");

    finish({ ok: true, data: { runId: "run_email" } });
    await waitFor(() => expect(email).toBeEnabled());
  });

  it("reaches both buttons by Tab in reading order", async () => {
    const user = userEvent.setup();
    renderWithIntl(<TestButtons />);
    await user.tab();
    expect(screen.getByRole("button", { name: de.emails.actions.testEmail })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: de.emails.actions.testAlert })).toHaveFocus();
  });
});
