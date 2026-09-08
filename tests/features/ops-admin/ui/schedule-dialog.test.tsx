import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatZurichWallClock } from "@/features/ops-admin/schema";
import { ScheduleDialog } from "@/features/ops-admin/ui/schedule-dialog";
import {
  chooseExpert,
  EXPERTS,
  en,
  NINA,
  ORDER_ID,
  REFERENCE,
  renderWithIntl,
  setDateTime,
  stubComboboxEnvironment,
  UELI,
} from "./helpers";

/**
 * The ops scheduling dialog (spec 0014, AC-3, AC-4, AC-5). What matters beyond the two fields:
 * the booking cannot be sent half filled, the wall clock time is passed on untouched so the
 * action reads it as Swiss time, and a refusal the database raised is shown in the dialog rather
 * than swallowed, because the dialog's own `min` is a hint and the database holds the guard.
 * The action, the router and the toaster are the boundaries.
 */
type Result = { ok: true; data?: unknown } | { ok: false; error: string };

const boundary = vi.hoisted(() => ({
  schedule: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/features/ops-admin/actions", () => ({ scheduleOrder: boundary.schedule }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/admin/orders",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: vi.fn() } }));

stubComboboxEnvironment();

const strings = en.adminOrders.schedule;
const WHEN = "2026-10-14T09:30";

function renderDialog(experts = EXPERTS) {
  return renderWithIntl(
    <ScheduleDialog orderId={ORDER_ID} reference={REFERENCE} experts={experts} />,
    "en-CH",
  );
}

/** Opens the dialog and returns it, so every lookup is scoped to the one order's form. */
async function openDialog(user: ReturnType<typeof userEvent.setup>, experts = EXPERTS) {
  renderDialog(experts);
  await user.click(screen.getByRole("button", { name: strings.open }));
  return await screen.findByRole("dialog");
}

/** Fills both fields and presses the submit button inside the dialog. */
async function book(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  when = WHEN,
  expert: string | RegExp = /Nina Keller/,
) {
  await setDateTime(user, within(dialog).getByLabelText(strings.date), when);
  await chooseExpert(user, expert, dialog);
  await user.click(within(dialog).getByRole("button", { name: strings.submit }));
}

beforeEach(() => {
  boundary.schedule.mockResolvedValue({ ok: true });
});

describe("opening the dialog", () => {
  it("names the order it is about to book", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    expect(within(dialog).getByText(strings.title)).toBeInTheDocument();
    expect(
      within(dialog).getByText(`Set the agreed date and the assessor for order ${REFERENCE}.`),
    ).toBeInTheDocument();
  });

  // `Field` does no id wiring of its own, so the hint is tied to the input by hand, the way the
  // facts and lookup forms do it. Without that the zone the time is read in is on screen but
  // never announced, and an ops user on a screen reader books an hour out.
  it("says the date is read as Swiss time, because ops elsewhere must not book an hour out", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    expect(within(dialog).getByText(strings.dateHint)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(strings.date)).toHaveAccessibleDescription(
      strings.dateHint,
    );
  });

  // The picker is a hint, not the guard: `check_expert_assignable` refuses an expert deactivated
  // between this read and the write (AC-4), so the list only has to offer the active ones.
  it("offers the active assessors by name, and names the unnamed one", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("combobox"));

    expect(await screen.findByRole("option", { name: /Nina Keller/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Ueli Roth/ })).toBeInTheDocument();
  });

  it("falls back to a placeholder name for an assessor with no full name", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user, [{ expertId: UELI, fullName: null, headline: null }]);
    await user.click(within(dialog).getByRole("combobox"));

    expect(await screen.findByRole("option", { name: strings.unnamed })).toBeInTheDocument();
  });

  it("says so when no assessor can be booked at all", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user, []);
    await user.click(within(dialog).getByRole("combobox"));

    expect(await screen.findByText(strings.noExperts)).toBeInTheDocument();
  });
});

describe("what a booking needs before it can be sent (AC-3)", () => {
  // The database refuses a booking missing either column, so sending one is a wasted round trip
  // and an error the ops user cannot act on.
  it("keeps the button dead until both the date and the assessor are set", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const submit = within(dialog).getByRole("button", { name: strings.submit });
    expect(submit).toBeDisabled();

    await setDateTime(user, within(dialog).getByLabelText(strings.date), WHEN);
    expect(submit).toBeDisabled();

    await chooseExpert(user, /Nina Keller/, dialog);
    expect(submit).toBeEnabled();
  });

  it("stays dead with an assessor but no date", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await chooseExpert(user, /Nina Keller/, dialog);

    expect(within(dialog).getByRole("button", { name: strings.submit })).toBeDisabled();
    expect(boundary.schedule).not.toHaveBeenCalled();
  });

  // The field carries a `min` so the browser steers ops away from a past date, but the refusal
  // that counts comes from the database (AC-5); a dialog left open overnight is caught there.
  it("offers now as the earliest bookable moment once mounted", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);

    await waitFor(() =>
      expect(within(dialog).getByLabelText(strings.date)).toHaveAttribute(
        "min",
        formatZurichWallClock(new Date()),
      ),
    );
  });
});

describe("booking the assessment (AC-3)", () => {
  it("sends the order, the wall clock time and the chosen assessor", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    await waitFor(() =>
      expect(boundary.schedule).toHaveBeenCalledWith(null, {
        orderId: ORDER_ID,
        scheduledAt: WHEN,
        expertId: NINA,
      }),
    );
  });

  // The wall clock time is handed over exactly as typed, with no zone and no conversion here:
  // the schema reads it as Europe/Zurich, so an ops user in another zone still books Swiss time.
  it("does not turn the wall clock time into an instant on the way out", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    await waitFor(() => expect(boundary.schedule).toHaveBeenCalled());
    const sent = boundary.schedule.mock.calls[0]?.[1] as { scheduledAt: string };
    expect(sent.scheduledAt).toBe(WHEN);
    expect(sent.scheduledAt).not.toMatch(/Z$/);
  });

  it("announces the booking, closes the dialog and refreshes so the row shows its new state", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.scheduled));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(boundary.refresh).toHaveBeenCalled();
  });

  // The success effect watches a `useActionState` result that stays `{ ok: true }` for the life of
  // the component, so it runs again on every later render: the dialog is slammed shut each time
  // and ops cannot book a second order without a full page load.
  it("reopens for the next order, cleared, once a booking is done", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: strings.open }));
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByLabelText(strings.date)).toHaveValue("");
    expect(within(reopened).getByRole("button", { name: strings.submit })).toBeDisabled();
  });

  // Four toasts and four refreshes came out of one booking, for the same reason: the effect has no
  // guard against a result it has already handled.
  it("announces the booking once, and refreshes once", async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.scheduled));
    expect(boundary.success).toHaveBeenCalledTimes(1);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("a refusal from the database (AC-4, AC-5)", () => {
  it("names a past date rather than closing on a booking that never happened", async () => {
    boundary.schedule.mockResolvedValue({ ok: false, error: "date_not_future" });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    expect(await within(dialog).findByText(strings.errors.date_not_future)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(boundary.success).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  // AC-4: the expert was deactivated between the picker's read and the write, so the database
  // refused the assignment and the order never moved.
  it("tells ops to choose another assessor when theirs went inactive", async () => {
    boundary.schedule.mockResolvedValue({ ok: false, error: "expert_not_assignable" });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    expect(
      await within(dialog).findByText(strings.errors.expert_not_assignable),
    ).toBeInTheDocument();
  });

  it("keeps what ops typed, so a second try is one press and not a refill", async () => {
    boundary.schedule.mockResolvedValue({ ok: false, error: "unexpected" });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    expect(await within(dialog).findByText(strings.errors.unexpected)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(strings.date)).toHaveValue(WHEN);

    boundary.schedule.mockResolvedValue({ ok: true });
    await user.click(within(dialog).getByRole("button", { name: strings.submit }));
    await waitFor(() => expect(boundary.schedule).toHaveBeenCalledTimes(2));
  });

  it("explains a lost race rather than showing a booking that did not happen", async () => {
    boundary.schedule.mockResolvedValue({ ok: false, error: "invalid_transition" });
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await book(user, dialog);

    expect(await within(dialog).findByText(strings.errors.invalid_transition)).toBeInTheDocument();
  });
});
