import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpertAccountActions } from "@/features/experts/ui/account-actions";
import { en, renderWithIntl } from "../../emails/ui/helpers";

/**
 * The three account controls on an expert's admin page (spec 0013, AC-3, AC-10). Which control
 * shows is decided by the status alone, because each is meaningful in exactly one state: a resend
 * button on an expert who has already signed in would send an invite that cannot be used, and a
 * deactivate button on an already ended account would suggest there is something left to end.
 * The three actions and the router are the boundaries.
 */
type Result = { ok: true; data?: unknown } | { ok: false; error: string };

const boundary = vi.hoisted(() => ({
  resend: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  deactivate: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  reactivate: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/features/experts/actions", () => ({
  resendInvite: boundary.resend,
  deactivateExpert: boundary.deactivate,
  reactivateExpert: boundary.reactivate,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/admin/experts/x",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: vi.fn() } }));

const strings = en.experts.account;
const EXPERT_ID = "0e000000-0000-4000-8000-00000000000a";

function renderActions(status: "invited" | "active" | "inactive", activeAssignments = 0) {
  return renderWithIntl(
    <ExpertAccountActions
      expertId={EXPERT_ID}
      status={status}
      fullName="Nina Keller"
      activeAssignments={activeAssignments}
    />,
    "en-CH",
  );
}

/**
 * Deactivating is two presses now: the trigger opens the confirmation, the dialog's own button
 * runs it. Both carry the same label, so the second is looked up inside the dialog.
 */
async function confirmDeactivate(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: strings.deactivate }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: strings.deactivate }));
}

beforeEach(() => {
  boundary.resend.mockResolvedValue({ ok: true });
  boundary.deactivate.mockResolvedValue({ ok: true, data: { endedAssignments: 0 } });
  boundary.reactivate.mockResolvedValue({ ok: true });
});

describe("which controls the status shows", () => {
  it("offers resend and deactivate while the expert is only invited", () => {
    renderActions("invited");
    expect(screen.getByRole("button", { name: strings.resend })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.deactivate })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.reactivate })).not.toBeInTheDocument();
  });

  it("drops the resend button once the expert has signed in", () => {
    renderActions("active");
    expect(screen.queryByRole("button", { name: strings.resend })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.deactivate })).toBeInTheDocument();
  });

  it("swaps deactivate for reactivate on an ended account", () => {
    renderActions("inactive");
    expect(screen.getByRole("button", { name: strings.reactivate })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.deactivate })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.resend })).not.toBeInTheDocument();
  });

  it("explains what the standing control will do", () => {
    const { unmount } = renderActions("active");
    expect(screen.getByText(strings.activeHint)).toBeInTheDocument();
    unmount();
    renderActions("inactive");
    expect(screen.getByText(strings.inactiveHint)).toBeInTheDocument();
  });
});

describe("resending the invitation (AC-3)", () => {
  it("sends the expert id and announces the send", async () => {
    const user = userEvent.setup();
    renderActions("invited");
    await user.click(screen.getByRole("button", { name: strings.resend }));

    await waitFor(() =>
      expect(boundary.resend).toHaveBeenCalledWith(null, { expertId: EXPERT_ID }),
    );
    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.resent));
  });

  it("explains a refusal beside the button instead of a toast", async () => {
    boundary.resend.mockResolvedValue({ ok: false, error: "rate_limited" });
    const user = userEvent.setup();
    renderActions("invited");
    await user.click(screen.getByRole("button", { name: strings.resend }));

    expect(await screen.findByText(strings.resendErrors.rate_limited)).toBeInTheDocument();
    expect(boundary.success).not.toHaveBeenCalled();
  });
});

describe("the deactivation confirmation (AC-10)", () => {
  // Deactivating ends every open assignment and blocks the sign in, and reactivating restores the
  // sign in but not the assignments, so the one press must not be the whole action.
  it("asks first and runs nothing until the confirmation is pressed", async () => {
    const user = userEvent.setup();
    renderActions("active", 3);
    await user.click(screen.getByRole("button", { name: strings.deactivate }));

    const dialog = await screen.findByRole("dialog");
    expect(boundary.deactivate).not.toHaveBeenCalled();
    // The dialog names the expert and how many assignments it will end, so ops can see they are
    // about to offboard the person they meant to.
    expect(within(dialog).getByText("Deactivate Nina Keller?")).toBeInTheDocument();
    expect(within(dialog).getByText(/3 open assignments will be ended\./)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: strings.deactivate }));
    await waitFor(() =>
      expect(boundary.deactivate).toHaveBeenCalledWith(null, { expertId: EXPERT_ID }),
    );
  });

  it("says plainly when nothing is open to end", async () => {
    const user = userEvent.setup();
    renderActions("active");
    await user.click(screen.getByRole("button", { name: strings.deactivate }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/No assignment is open/)).toBeInTheDocument();
  });

  it("abandons the offboarding when ops back out", async () => {
    const user = userEvent.setup();
    renderActions("active", 1);
    await user.click(screen.getByRole("button", { name: strings.deactivate }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: strings.deactivateCancel }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(boundary.deactivate).not.toHaveBeenCalled();
  });
});

describe("offboarding and restoring (AC-10)", () => {
  it("counts the assignments it ended in the confirmation", async () => {
    boundary.deactivate.mockResolvedValue({ ok: true, data: { endedAssignments: 2 } });
    const user = userEvent.setup();
    renderActions("active", 2);
    await confirmDeactivate(user);

    await waitFor(() =>
      expect(boundary.success).toHaveBeenCalledWith(
        "Expert deactivated. 2 assignments were ended.",
      ),
    );
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("says so plainly when there was nothing open to end", async () => {
    const user = userEvent.setup();
    renderActions("active");
    await confirmDeactivate(user);

    await waitFor(() =>
      expect(boundary.success).toHaveBeenCalledWith(
        "Expert deactivated. No assignments were open.",
      ),
    );
  });

  it("announces a restore and refreshes so the status badge follows", async () => {
    const user = userEvent.setup();
    renderActions("inactive");
    await user.click(screen.getByRole("button", { name: strings.reactivate }));

    await waitFor(() =>
      expect(boundary.reactivate).toHaveBeenCalledWith(null, { expertId: EXPERT_ID }),
    );
    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.reactivated));
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("stays pressable after a failure, because each action is idempotent by design", async () => {
    // Pressing again is how a half finished offboarding is finished; a button disabled by its own
    // failure would leave ops with no way to complete it.
    boundary.deactivate.mockResolvedValue({ ok: false, error: "unexpected" });
    const user = userEvent.setup();
    renderActions("active");
    await confirmDeactivate(user);

    expect(await screen.findByText(strings.deactivateErrors.unexpected)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.deactivate })).toBeEnabled();

    boundary.deactivate.mockResolvedValue({ ok: true, data: { endedAssignments: 1 } });
    await confirmDeactivate(user);
    await waitFor(() => expect(boundary.deactivate).toHaveBeenCalledTimes(2));
  });

  it("names the reason a restore was refused", async () => {
    boundary.reactivate.mockResolvedValue({ ok: false, error: "already_active" });
    const user = userEvent.setup();
    renderActions("inactive");
    await user.click(screen.getByRole("button", { name: strings.reactivate }));

    expect(await screen.findByText(strings.reactivateErrors.already_active)).toBeInTheDocument();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });
});
