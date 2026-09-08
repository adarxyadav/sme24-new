import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryActions } from "@/features/ops-admin/ui/delivery-actions";
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
 * The ops delivery controls on a booked order (spec 0014, AC-6, AC-7, AC-7a). The point of the
 * component is that the row's own state decides which edges are offered, so the two forward edges
 * can never be pressed out of order and a delivered order offers no way back. The database refuses
 * everything else regardless, and a refusal it raises has to reach the ops user rather than vanish.
 * The three actions, the router and the toaster are the boundaries.
 */
type Result = { ok: true; data?: unknown } | { ok: false; error: string };

const boundary = vi.hoisted(() => ({
  advance: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  release: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  correct: vi.fn<(previous: Result | null, input: unknown) => Promise<Result>>(),
  refresh: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/features/ops-admin/actions", () => ({
  setOrderDeliveryState: boundary.advance,
  unscheduleOrder: boundary.release,
  rescheduleOrder: boundary.correct,
}));
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

const strings = en.adminOrders.delivery;
const BOOKED = "2026-10-14T09:30";

function renderActions(status: string, overrides: { scheduledAt?: string | null } = {}) {
  return renderWithIntl(
    <DeliveryActions
      orderId={ORDER_ID}
      reference={REFERENCE}
      status={status}
      scheduledAt={overrides.scheduledAt === undefined ? BOOKED : overrides.scheduledAt}
      assignedExpertId={NINA}
      experts={EXPERTS}
    />,
    "en-CH",
  );
}

/** Opens the correction dialog and returns it. */
async function openCorrection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: strings.correct.open }));
  return await screen.findByRole("dialog");
}

beforeEach(() => {
  boundary.advance.mockResolvedValue({ ok: true });
  boundary.release.mockResolvedValue({ ok: true });
  boundary.correct.mockResolvedValue({ ok: true });
});

describe("which controls the state offers (AC-6, AC-7)", () => {
  it("renders nothing at all on an order that was never booked", () => {
    const { container } = renderActions("paid");
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing on a cancelled or refunded order either", () => {
    const { unmount } = renderActions("cancelled");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();
    const { container } = renderActions("refunded");
    expect(container).toBeEmptyDOMElement();
  });

  it("offers start, change and unschedule on a booked order", () => {
    renderActions("scheduled");
    expect(screen.getByRole("button", { name: strings.advance.in_progress })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.correct.open })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: strings.release.open })).toBeInTheDocument();
  });

  // Releasing is the `scheduled -> paid` edge only: once the visit has started there is nothing to
  // release, and the forward edge is `in_progress -> delivered`.
  it("swaps start for mark delivered once the visit is running, and drops the release", () => {
    renderActions("in_progress");
    expect(screen.getByRole("button", { name: strings.advance.delivered })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: strings.advance.in_progress }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.release.open })).not.toBeInTheDocument();
  });

  // `delivered` is the end of the line: the one edge out is `refunded`, which is not this control.
  it("leaves a delivered order only the correction, with no forward edge and no release", () => {
    renderActions("delivered");
    expect(screen.getByRole("button", { name: strings.correct.open })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: strings.advance.in_progress }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: strings.advance.delivered }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.release.open })).not.toBeInTheDocument();
  });
});

describe("moving the order forward (AC-6)", () => {
  it("sends the next state the row's own status allows", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.advance.in_progress }));

    await waitFor(() =>
      expect(boundary.advance).toHaveBeenCalledWith(null, {
        orderId: ORDER_ID,
        next: "in_progress",
      }),
    );
  });

  it("sends delivered from a running visit, never straight from booked", async () => {
    const user = userEvent.setup();
    renderActions("in_progress");
    await user.click(screen.getByRole("button", { name: strings.advance.delivered }));

    await waitFor(() =>
      expect(boundary.advance).toHaveBeenCalledWith(null, { orderId: ORDER_ID, next: "delivered" }),
    );
  });

  // The status, the date and the assessor all come from the server, so the row is refetched rather
  // than patched here: a stale row would offer the wrong edge next.
  it("announces the move and refreshes the row", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.advance.in_progress }));

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.advanced));
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("shows a refused move beside the button instead of a toast", async () => {
    boundary.advance.mockResolvedValue({ ok: false, error: "invalid_transition" });
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.advance.in_progress }));

    expect(await screen.findByText(strings.errors.invalid_transition)).toBeInTheDocument();
    expect(boundary.success).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });
});

describe("releasing a booking (AC-7)", () => {
  // Releasing clears the date and the assessor, so it asks first rather than acting on one press.
  it("asks first, and clears nothing until the confirmation is pressed", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.release.open }));

    const dialog = await screen.findByRole("dialog");
    expect(boundary.release).not.toHaveBeenCalled();
    expect(within(dialog).getByText(strings.release.title)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: strings.release.confirm }));
    await waitFor(() => expect(boundary.release).toHaveBeenCalledWith(null, { orderId: ORDER_ID }));
  });

  // The assignment is deliberately left alone, so the assessor keeps access until ops end it: the
  // dialog has to say so, because the opposite would be the reasonable assumption.
  it("says the assessor keeps access to the client", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.release.open }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(strings.release.note)).toBeInTheDocument();
  });

  it("announces the release and refreshes so the row falls back to paid", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.release.open }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: strings.release.confirm }));

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.released));
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("explains a refusal inside the dialog rather than closing on nothing", async () => {
    boundary.release.mockResolvedValue({ ok: false, error: "not_scheduled" });
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.release.open }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: strings.release.confirm }));

    expect(await within(dialog).findByText(strings.errors.not_scheduled)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("correcting the date or the assessor (AC-7a)", () => {
  it("opens seeded with what the order already carries, so a small fix is a small edit", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);

    expect(within(dialog).getByLabelText(strings.correct.date)).toHaveValue(BOOKED);
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("Nina Keller");
  });

  it("sends the corrected date and assessor without naming a status", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);
    await setDateTime(
      user,
      within(dialog).getByLabelText(strings.correct.date),
      "2026-11-02T14:00",
    );
    await chooseExpert(user, /Ueli Roth/, dialog);
    await user.click(within(dialog).getByRole("button", { name: strings.correct.submit }));

    await waitFor(() =>
      expect(boundary.correct).toHaveBeenCalledWith(null, {
        orderId: ORDER_ID,
        scheduledAt: "2026-11-02T14:00",
        expertId: UELI,
      }),
    );
    const sent = boundary.correct.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent).not.toHaveProperty("status");
    expect(sent).not.toHaveProperty("next");
  });

  // The asymmetry is the point (spec 0014, State transitions): a booked order still has to be
  // corrected into the future, but an `in_progress` or `delivered` one is recording a visit that
  // already happened, so the database drops its future check and the form drops its `min` too.
  it("holds a booked order to a future date", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);

    await waitFor(() =>
      expect(within(dialog).getByLabelText(strings.correct.date)).toHaveAttribute("min"),
    );
    expect(within(dialog).getByText(strings.correct.dateHintFuture)).toBeInTheDocument();
  });

  it("lets a running visit be recorded at a past date, with no floor on the field", async () => {
    const user = userEvent.setup();
    renderActions("in_progress");
    const dialog = await openCorrection(user);

    expect(within(dialog).getByLabelText(strings.correct.date)).not.toHaveAttribute("min");
    expect(within(dialog).getByText(strings.correct.dateHintPast)).toBeInTheDocument();
  });

  it("lets a delivered order be corrected to a past date too", async () => {
    const user = userEvent.setup();
    renderActions("delivered");
    const dialog = await openCorrection(user);

    expect(within(dialog).getByLabelText(strings.correct.date)).not.toHaveAttribute("min");
  });

  // The database refuses a correction that nulls either column on its own, so a half filled form
  // is a wasted round trip.
  it("keeps the save dead while either field is empty", async () => {
    const user = userEvent.setup();
    renderActions("scheduled", { scheduledAt: null });
    const dialog = await openCorrection(user);
    const save = within(dialog).getByRole("button", { name: strings.correct.submit });
    expect(save).toBeDisabled();

    await setDateTime(user, within(dialog).getByLabelText(strings.correct.date), BOOKED);
    expect(save).toBeEnabled();
  });

  // Handing the client to another assessor takes the previous one's access away, so the dialog
  // says what the change does before ops make it.
  it("warns that changing the assessor moves the client's access", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);

    expect(within(dialog).getByText(strings.correct.expertHint)).toBeInTheDocument();
  });

  it("announces the correction and refreshes the row", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);
    await user.click(within(dialog).getByRole("button", { name: strings.correct.submit }));

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.corrected));
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("names a refused correction and keeps the dialog open on what ops typed", async () => {
    boundary.correct.mockResolvedValue({ ok: false, error: "expert_not_assignable" });
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);
    await user.click(within(dialog).getByRole("button", { name: strings.correct.submit }));

    expect(
      await within(dialog).findByText(strings.errors.expert_not_assignable),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(strings.correct.date)).toHaveValue(BOOKED);
  });
});

describe("what a finished write leaves behind", () => {
  // The success effects watch a `useActionState` result that stays `{ ok: true }` for the life of
  // the component, with no guard against a result they have already handled. The forward edge
  // survives it because nothing re-renders the row afterwards, but a dialog re-renders as it
  // closes, so its effect runs a second time: the correction toasts and refreshes twice and the
  // dialog is slammed shut again, leaving ops unable to make a second edit without a page load.
  it("announces a move once, and refreshes once", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    await user.click(screen.getByRole("button", { name: strings.advance.in_progress }));

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.advanced));
    expect(boundary.success).toHaveBeenCalledTimes(1);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });

  it("announces a correction once, and refreshes once", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);
    await user.click(within(dialog).getByRole("button", { name: strings.correct.submit }));

    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(strings.corrected));
    expect(boundary.success).toHaveBeenCalledTimes(1);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });

  it("reopens the correction dialog for a second edit", async () => {
    const user = userEvent.setup();
    renderActions("scheduled");
    const dialog = await openCorrection(user);
    await user.click(within(dialog).getByRole("button", { name: strings.correct.submit }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: strings.correct.open }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
