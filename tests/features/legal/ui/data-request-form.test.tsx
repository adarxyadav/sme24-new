import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateDataRequestResult } from "@/features/legal/actions";
import type { DataRequestKind, DataRequestStatus } from "@/features/legal/schema";
import { navigationMock, REQUEST_ID, renderWithIntl, stubRadixEnvironment } from "./helpers";

/**
 * The ops workflow form of one data request (spec 0015, AC-14, AC-15).
 *
 * The select offers the current status plus exactly the moves the adjacency list allows out of it,
 * so an illegal move is not something the UI can express at all. That is the property to defend
 * here: the action checks the same list again against the stored status, because a stale page is
 * still a possible caller, but a form that offered `new -> fulfilled` would put ops in front of a
 * refusal they could not understand.
 *
 * Fulfilling a deletion anonymises the person, so the warning has to appear the moment that option
 * is chosen and before the save, not after it. This is the one screen where a wrong click is
 * irreversible.
 */
const boundary = vi.hoisted(() => ({
  updateDataRequest:
    vi.fn<(previous: unknown, input: unknown) => Promise<UpdateDataRequestResult>>(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
  refresh: vi.fn(),
}));

vi.mock("@/features/legal/actions", () => ({ updateDataRequest: boundary.updateDataRequest }));
vi.mock("sonner", () => ({ toast: boundary.toast }));
vi.mock("next/navigation", () => ({
  ...navigationMock(),
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    prefetch: () => {},
    back: () => {},
    refresh: boundary.refresh,
  }),
}));

stubRadixEnvironment();

const { DataRequestForm } = await import("@/features/legal/ui/data-request-form");

type Props = {
  kind?: DataRequestKind;
  status?: DataRequestStatus;
  opsNote?: string | null;
};

const renderForm = ({ kind = "export", status = "new", opsNote = null }: Props = {}) =>
  renderWithIntl(
    <DataRequestForm id={REQUEST_ID} kind={kind} status={status} opsNote={opsNote} />,
    "en-CH",
  );

const statusSelect = () => screen.getByRole("combobox", { name: "Status" });
const note = () => screen.getByRole("textbox", { name: "What was done" });
const save = () => screen.getByRole("button", { name: "Save" });

/** Opens the status select and reads the options it offers. */
async function optionsOf(user: ReturnType<typeof userEvent.setup>) {
  await user.click(statusSelect());
  const listbox = await screen.findByRole("listbox");
  return within(listbox)
    .getAllByRole("option")
    .map((option) => option.textContent?.trim());
}

/** Picks one status in the open select. */
async function choose(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(statusSelect());
  await user.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  boundary.updateDataRequest.mockResolvedValue({
    ok: true,
    data: { id: REQUEST_ID, status: "in_progress" },
  });
});

/**
 * The moves offered are the adjacency list, rendered. Anything more would let ops attempt a move
 * the action refuses; anything less would hide a legitimate one.
 */
describe("the moves the select offers (AC-14)", () => {
  it("offers staying put, in progress and refused from new, and no shortcut to fulfilled", async () => {
    const user = userEvent.setup();
    renderForm({ status: "new" });
    expect(await optionsOf(user)).toEqual(["New", "In progress", "Refused"]);
  });

  it("offers staying put, fulfilled and refused from in progress, and no way back to new", async () => {
    const user = userEvent.setup();
    renderForm({ status: "in_progress" });
    expect(await optionsOf(user)).toEqual(["In progress", "Fulfilled", "Refused"]);
  });

  it("shows a terminal request as closed rather than as a disabled form", async () => {
    for (const status of ["fulfilled", "refused"] as const) {
      const view = renderForm({ status });
      // A greyed out form invites a try; a sentence says there is nothing to do here.
      expect(screen.getByText(/is closed. A further request is filed as a new one/)).toBeVisible();
      expect(screen.queryByRole("button", { name: "Save" }), status).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox"), status).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("keeps the current status selected, so saving a note alone is possible", () => {
    renderForm({ status: "in_progress" });
    expect(statusSelect()).toHaveTextContent("In progress");
  });

  it("seeds the note with what is already on the record", () => {
    renderForm({ opsNote: "Copy sent by post." });
    expect(note()).toHaveValue("Copy sent by post.");
  });
});

/**
 * The warning is bound to the chosen status rather than to the save, so ops read it while they can
 * still change their mind. It appears only for the one irreversible combination.
 */
describe("the deletion warning (AC-15)", () => {
  const warning = () => screen.queryByText(/anonymises the person immediately/);

  it("appears the moment fulfilled is chosen on a deletion, before any save", async () => {
    const user = userEvent.setup();
    renderForm({ kind: "deletion", status: "in_progress" });
    expect(warning()).not.toBeInTheDocument();
    await choose(user, "Fulfilled");
    expect(warning()).toBeInTheDocument();
    expect(boundary.updateDataRequest).not.toHaveBeenCalled();
  });

  it("says the orders and invoices are kept, which is what the privacy page promises", async () => {
    const user = userEvent.setup();
    renderForm({ kind: "deletion", status: "in_progress" });
    await choose(user, "Fulfilled");
    expect(screen.getByText(/Orders and invoices are kept/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
  });

  it("stays away when a deletion is refused rather than fulfilled", async () => {
    const user = userEvent.setup();
    renderForm({ kind: "deletion", status: "in_progress" });
    await choose(user, "Refused");
    expect(warning()).not.toBeInTheDocument();
  });

  it("stays away when an export is fulfilled, since nothing is anonymised", async () => {
    const user = userEvent.setup();
    renderForm({ kind: "export", status: "in_progress" });
    await choose(user, "Fulfilled");
    expect(warning()).not.toBeInTheDocument();
  });

  it("goes away again if the choice is changed back", async () => {
    const user = userEvent.setup();
    renderForm({ kind: "deletion", status: "in_progress" });
    await choose(user, "Fulfilled");
    expect(warning()).toBeInTheDocument();
    await choose(user, "In progress");
    expect(warning()).not.toBeInTheDocument();
  });
});

describe("saving (AC-14)", () => {
  it("sends the move and the trimmed note, then confirms and refreshes", async () => {
    const user = userEvent.setup();
    renderForm({ status: "new" });
    await choose(user, "In progress");
    await user.type(note(), "  Started assembling.  ");
    await user.click(save());
    await waitFor(() =>
      expect(boundary.updateDataRequest).toHaveBeenCalledWith(
        null,
        expect.objectContaining({
          id: REQUEST_ID,
          status: "in_progress",
          opsNote: "Started assembling.",
        }),
      ),
    );
    await waitFor(() => expect(boundary.toast.success).toHaveBeenCalledWith("Request updated."));
    expect(boundary.refresh).toHaveBeenCalled();
  });

  it("marks the note required in the browser when a refusal is chosen", async () => {
    const user = userEvent.setup();
    renderForm({ status: "new" });
    expect(note()).not.toBeRequired();
    await choose(user, "Refused");
    expect(note()).toBeRequired();
  });

  it("refuses a note past 2000 characters with the translated message, sending nothing", async () => {
    const user = userEvent.setup();
    renderForm({ status: "new" });
    // `paste` rather than `type`: two thousand keystrokes would take minutes.
    await user.click(note());
    await user.paste("x".repeat(2001));
    await user.click(save());
    expect(await screen.findByText("Keep the note under 2000 characters.")).toBeInTheDocument();
    expect(boundary.updateDataRequest).not.toHaveBeenCalled();
  });

  it("shows the action's refusal in the words ops can act on", async () => {
    boundary.updateDataRequest.mockResolvedValue({ ok: false, error: "invalid_transition" });
    const user = userEvent.setup();
    renderForm({ status: "new" });
    await choose(user, "In progress");
    await user.click(save());
    expect(
      await screen.findByText(/That move is not allowed from the current status/),
    ).toBeInTheDocument();
    expect(boundary.toast.success).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("shows the missing reason refusal in its own words", async () => {
    boundary.updateDataRequest.mockResolvedValue({ ok: false, error: "note_required" });
    const user = userEvent.setup();
    renderForm({ status: "new" });
    await choose(user, "Refused");
    await user.type(note(), "x");
    await user.click(save());
    expect(await screen.findByText(/A refusal needs a reason/)).toBeInTheDocument();
  });

  /**
   * The success work sits in the handler that awaited the dispatch, never in an effect watching
   * `result`: `useActionState` keeps its last value for the life of the component, so an effect
   * would toast the same save again on every later render.
   */
  it("announces one save once, however many times the form re renders afterwards", async () => {
    const user = userEvent.setup();
    const view = renderForm({ status: "new" });
    await choose(user, "In progress");
    await user.click(save());
    await waitFor(() => expect(boundary.toast.success).toHaveBeenCalledTimes(1));
    view.rerender(<div />);
    expect(boundary.toast.success).toHaveBeenCalledTimes(1);
  });
});

describe("the form's accessibility", () => {
  it("labels the status select and the note, and describes the note's rule", () => {
    renderForm();
    expect(statusSelect()).toBeInTheDocument();
    expect(note()).toHaveAccessibleDescription(/For an export, record what was sent/);
  });

  it("marks itself busy while a save is in flight", async () => {
    let settle: (value: UpdateDataRequestResult) => void = () => {};
    boundary.updateDataRequest.mockReturnValue(
      new Promise<UpdateDataRequestResult>((resolve) => {
        settle = resolve;
      }),
    );
    const user = userEvent.setup();
    const { container } = renderForm({ status: "new" });
    await choose(user, "In progress");
    await user.click(save());
    await waitFor(() =>
      expect(container.querySelector("form")).toHaveAttribute("aria-busy", "true"),
    );
    settle({ ok: true, data: { id: REQUEST_ID, status: "in_progress" } });
  });
});
