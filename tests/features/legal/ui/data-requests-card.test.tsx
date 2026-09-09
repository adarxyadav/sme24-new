import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MyRequest, MyRequestsResult, RequestDataResult } from "@/features/legal/actions";
import { navigationMock, REQUEST_ID, renderWithIntl, stubRadixEnvironment } from "./helpers";

/**
 * The data rights card on the cookies page (spec 0015, AC-11).
 *
 * The card sits on a statically prerendered page, so it knows nothing about the viewer at build
 * time and has to ask after mount. That gives it four states rather than one, and three of them
 * are easy to get wrong: a signed out visitor is an answer rather than an error, a failed read is
 * an error rather than an empty list, and the moment before either is a skeleton rather than a
 * flash of "you have no requests".
 *
 * Filing is confirmed for both rights, not just the deletion: an export starts a thirty day clock
 * for a colleague, so neither is a button worth pressing by accident.
 *
 * The `already_open` path is one of the two defects `/debug` found on 2026-09-09: it degraded in
 * silence because the card lived outside the shell that mounts the toaster, so the user pressed the
 * button and nothing whatsoever happened. `tests/features/legal/ui/cookies-page.test.tsx` covers
 * the region being mounted; what is asserted here is that the card asks for the message at all.
 */
const boundary = vi.hoisted(() => ({
  myDataRequests: vi.fn<() => Promise<MyRequestsResult>>(),
  requestData: vi.fn<(previous: unknown, input: unknown) => Promise<RequestDataResult>>(),
  toast: {
    success: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}));

vi.mock("@/features/legal/actions", () => ({
  myDataRequests: boundary.myDataRequests,
  requestData: boundary.requestData,
}));
vi.mock("sonner", () => ({ toast: boundary.toast }));
vi.mock("next/navigation", () => navigationMock());

stubRadixEnvironment();

const { DataRequestsCard } = await import("@/features/legal/ui/data-requests-card");

/** One of the caller's own rows, as `myDataRequests` hands it to the card. */
function myRequest(overrides: Partial<MyRequest> = {}): MyRequest {
  return {
    id: REQUEST_ID,
    kind: "export",
    status: "new",
    dueAt: "2026-10-09T08:00:00.000Z",
    createdAt: "2026-09-09T08:00:00.000Z",
    ...overrides,
  };
}

const signedInWith = (rows: readonly MyRequest[]): MyRequestsResult => ({
  ok: true,
  data: { signedIn: true, rows },
});

const exportButton = () => screen.getByRole("button", { name: "Request a copy" });
const deletionButton = () => screen.getByRole("button", { name: "Request deletion" });

/** Opens one right's confirmation and presses its submit, the two steps every filing takes. */
async function file(user: ReturnType<typeof userEvent.setup>, kind: "export" | "deletion") {
  await user.click(kind === "export" ? exportButton() : deletionButton());
  const dialog = await screen.findByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", {
      name: kind === "export" ? "Request a copy" : "Request deletion",
    }),
  );
}

beforeEach(() => {
  boundary.myDataRequests.mockResolvedValue(signedInWith([]));
  boundary.requestData.mockResolvedValue({ ok: true, data: { id: REQUEST_ID, kind: "export" } });
});

describe("what the card asks and shows (AC-11)", () => {
  it("asks for its own state after mount, since the page around it is static (AC-5)", async () => {
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await waitFor(() => expect(boundary.myDataRequests).toHaveBeenCalledTimes(1));
  });

  it("shows the explanation and no request controls to a signed out visitor", async () => {
    boundary.myDataRequests.mockResolvedValue({ ok: true, data: { signedIn: false, rows: [] } });
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByText(/Sign in to make a request/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request a copy" })).not.toBeInTheDocument();
  });

  it("offers both rights to a signed in person with nothing filed", async () => {
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByRole("button", { name: "Request a copy" })).toBeInTheDocument();
    expect(deletionButton()).toBeInTheDocument();
  });

  it("shows a failed read as an error rather than as an empty list", async () => {
    boundary.myDataRequests.mockResolvedValue({ ok: false, error: "unexpected" });
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong.");
    // Offering the buttons here would invite a filing whose result nobody could see.
    expect(screen.queryByRole("button", { name: "Request a copy" })).not.toBeInTheDocument();
  });

  it("shows a skeleton while asking, rather than a flash of the empty state", () => {
    boundary.myDataRequests.mockReturnValue(new Promise(() => {}));
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(screen.queryByRole("button", { name: "Request a copy" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Sign in to make a request/)).not.toBeInTheDocument();
  });
});

describe("the rows already filed (AC-11)", () => {
  it("names the right and its status, with the answer deadline while it is open", async () => {
    boundary.myDataRequests.mockResolvedValue(signedInWith([myRequest()]));
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByText("Copy of my data")).toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Answer due by 09.10.2026")).toBeInTheDocument();
  });

  it("keeps showing the deadline while the request is being prepared", async () => {
    boundary.myDataRequests.mockResolvedValue(signedInWith([myRequest({ status: "in_progress" })]));
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByText("Being prepared")).toBeInTheDocument();
    expect(screen.getByText("Answer due by 09.10.2026")).toBeInTheDocument();
  });

  it("drops the deadline once the request is closed, since there is nothing left to wait for", async () => {
    for (const status of ["fulfilled", "refused"] as const) {
      const view = renderWithIntl(<DataRequestsCard />, "en-CH");
      boundary.myDataRequests.mockResolvedValue(signedInWith([myRequest({ status })]));
      view.unmount();
      const next = renderWithIntl(<DataRequestsCard />, "en-CH");
      await screen.findByText(status === "fulfilled" ? "Answered" : "Refused");
      expect(screen.queryByText(/Answer due by/), status).not.toBeInTheDocument();
      next.unmount();
    }
  });

  it("shows a deletion row under its own name", async () => {
    boundary.myDataRequests.mockResolvedValue(signedInWith([myRequest({ kind: "deletion" })]));
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByText("Deletion")).toBeInTheDocument();
  });

  it("still offers both rights beside an existing row, since the guard is the database's", async () => {
    boundary.myDataRequests.mockResolvedValue(signedInWith([myRequest()]));
    renderWithIntl(<DataRequestsCard />, "en-CH");
    expect(await screen.findByRole("button", { name: "Request a copy" })).toBeInTheDocument();
    expect(deletionButton()).toBeInTheDocument();
  });
});

/**
 * Both rights are confirmed, and the deletion's confirmation has to state the accounting exception
 * in plain words: the privacy page promises it, so the dialog cannot quietly say "everything is
 * deleted" while Art. 958f CO keeps the invoices for ten years.
 */
describe("confirming before filing (AC-11)", () => {
  it("files nothing until the confirmation is submitted", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await user.click(await screen.findByRole("button", { name: "Request a copy" }));
    await screen.findByRole("dialog");
    expect(boundary.requestData).not.toHaveBeenCalled();
  });

  it("lets the person back out, filing nothing", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await user.click(await screen.findByRole("button", { name: "Request a copy" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(boundary.requestData).not.toHaveBeenCalled();
  });

  it("states the ten year accounting exception before a deletion is confirmed", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await user.click(await screen.findByRole("button", { name: "Request deletion" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Art. 958f CO/)).toBeInTheDocument();
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
  });
});

describe("filing (AC-11)", () => {
  it("files the export and confirms it, then reloads the list", async () => {
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await screen.findByRole("button", { name: "Request a copy" });
    await file(user, "export");
    await waitFor(() =>
      expect(boundary.requestData).toHaveBeenCalledWith(null, { kind: "export" }),
    );
    await waitFor(() =>
      expect(boundary.toast.success).toHaveBeenCalledWith(
        "Request received. We will send your copy within 30 days.",
      ),
    );
    // The row it just created has to appear without a reload, so the list is asked again.
    await waitFor(() => expect(boundary.myDataRequests).toHaveBeenCalledTimes(2));
  });

  it("files the deletion and confirms it in its own words", async () => {
    boundary.requestData.mockResolvedValue({
      ok: true,
      data: { id: REQUEST_ID, kind: "deletion" },
    });
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await screen.findByRole("button", { name: "Request deletion" });
    await file(user, "deletion");
    await waitFor(() =>
      expect(boundary.requestData).toHaveBeenCalledWith(null, { kind: "deletion" }),
    );
    await waitFor(() =>
      expect(boundary.toast.success).toHaveBeenCalledWith(
        "Request received. We will answer within 30 days.",
      ),
    );
  });

  it("closes the confirmation whatever the answer was", async () => {
    boundary.requestData.mockResolvedValue({ ok: false, error: "unexpected" });
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await screen.findByRole("button", { name: "Request a copy" });
    await file(user, "export");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

/**
 * The regression half of the `/debug` finding: before the fix these three paths reported nothing
 * at all, because the card renders outside the shell that mounts the toaster. The success path
 * degraded quietly (the list reloaded), but `already_open` and the errors left the person pressing
 * a button that appeared to do nothing.
 */
describe("what the person is told when it does not work (AC-11)", () => {
  it("says the open request already exists, as a sentence rather than an error", async () => {
    boundary.requestData.mockResolvedValue({ ok: false, error: "already_open" });
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await screen.findByRole("button", { name: "Request a copy" });
    await file(user, "export");
    await waitFor(() =>
      expect(boundary.toast.info).toHaveBeenCalledWith(
        "You already have an open request of this kind. We will answer it within 30 days.",
      ),
    );
    expect(boundary.toast.error).not.toHaveBeenCalled();
  });

  it("does not reload the list when nothing was filed", async () => {
    boundary.requestData.mockResolvedValue({ ok: false, error: "already_open" });
    const user = userEvent.setup();
    renderWithIntl(<DataRequestsCard />, "en-CH");
    await screen.findByRole("button", { name: "Request a copy" });
    await file(user, "export");
    await waitFor(() => expect(boundary.toast.info).toHaveBeenCalled());
    expect(boundary.myDataRequests).toHaveBeenCalledTimes(1);
  });

  it("reports each remaining refusal in its own words", async () => {
    const messages = {
      forbidden: "Please sign in again to make a request.",
      validation: "That request could not be read. Please try again.",
      unexpected: "Something went wrong. Please try again.",
    } as const;
    for (const [error, message] of Object.entries(messages)) {
      boundary.toast.error.mockClear();
      boundary.requestData.mockResolvedValue({ ok: false, error: error as "forbidden" });
      const user = userEvent.setup();
      const view = renderWithIntl(<DataRequestsCard />, "en-CH");
      await screen.findByRole("button", { name: "Request a copy" });
      await file(user, "export");
      await waitFor(() => expect(boundary.toast.error, error).toHaveBeenCalledWith(message));
      view.unmount();
    }
  });

  it("announces one filing once, however many times the card re renders afterwards", async () => {
    const user = userEvent.setup();
    const view = renderWithIntl(<DataRequestsCard />, "en-CH");
    await screen.findByRole("button", { name: "Request a copy" });
    await file(user, "export");
    await waitFor(() => expect(boundary.toast.success).toHaveBeenCalledTimes(1));
    // `useActionState` holds its last value for the life of the component, so a success effect
    // watching `result` would announce this write again on every later render. The work lives in
    // the click handler instead, which is what this asserts.
    view.rerender(<div />);
    expect(boundary.toast.success).toHaveBeenCalledTimes(1);
  });
});
