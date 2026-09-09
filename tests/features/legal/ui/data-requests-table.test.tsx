import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DataRequestRow } from "@/features/legal/queries";
import type { DataRequestFilters } from "@/features/legal/schema";
import { navigationMock, OTHER_REQUEST_ID, REQUEST_ID, renderWithIntl } from "./helpers";

/**
 * The ops queue of data requests (spec 0015, AC-13).
 *
 * This list exists to stop a thirty day answer window being missed, so the two things that matter
 * are the deadline being first and an overdue row being visibly overdue. Everything else on the
 * row is context for the person working it.
 *
 * The empty state is two states, not one: nothing filed at all is good news and says so, while
 * nothing matching a filter is a dead end that has to offer the way out of it.
 */
vi.mock("next/navigation", () => navigationMock());

const { DataRequestsTable, DataRequestStatusBadge } = await import(
  "@/features/legal/ui/data-requests-table"
);

/** A queue row with the two joined names, as `listDataRequests` returns it. */
function row(overrides: Partial<DataRequestRow> = {}): DataRequestRow {
  return {
    id: REQUEST_ID,
    kind: "export",
    status: "new",
    due_at: "2026-10-09T08:00:00.000Z",
    created_at: "2026-09-09T08:00:00.000Z",
    requested_by: "0c000000-0000-4000-8000-000000000001",
    organization_id: "0c000000-0000-4000-8000-000000000002",
    handled_by: null,
    handled_at: null,
    ops_note: null,
    updated_at: "2026-09-09T08:00:00.000Z",
    subject: { full_name: "Clara Client" },
    organization: { name: "ACME AG" },
    ...overrides,
  } as DataRequestRow;
}

const OPEN: DataRequestFilters = { status: "open" };
/** A moment before every row's deadline, so nothing is overdue unless a test makes it so. */
const NOW = new Date("2026-09-20T08:00:00.000Z");

const renderTable = (
  rows: readonly DataRequestRow[],
  filters: DataRequestFilters = OPEN,
  nextCursor: string | null = null,
  now: Date = NOW,
) =>
  renderWithIntl(
    <DataRequestsTable rows={rows} nextCursor={nextCursor} filters={filters} now={now} />,
    "en-CH",
  );

const rowFor = (id: string) =>
  document.querySelector(`[data-request-id="${id}"]`) as HTMLElement | null;

describe("what a row shows (AC-13)", () => {
  it("names the deadline, the right, the subject, the client, the filing date and the status", () => {
    renderTable([row()]);
    const entry = rowFor(REQUEST_ID) as HTMLElement;
    expect(within(entry).getByText("09.10.2026")).toBeInTheDocument();
    expect(within(entry).getByRole("link", { name: "Copy of data" })).toBeInTheDocument();
    expect(within(entry).getByText("Clara Client")).toBeInTheDocument();
    expect(within(entry).getByText("ACME AG")).toBeInTheDocument();
    expect(within(entry).getByText("09.09.2026")).toBeInTheDocument();
    expect(within(entry).getByText("New")).toBeInTheDocument();
  });

  it("links the row to its detail page", () => {
    renderTable([row()]);
    expect(screen.getByRole("link", { name: "Copy of data" })).toHaveAttribute(
      "href",
      `/en/admin/data-requests/${REQUEST_ID}`,
    );
  });

  it("says so plainly when the subject has no name on file", () => {
    // A fulfilled deletion nulls `profiles.full_name`, so the queue keeps rendering afterwards.
    renderTable([row({ subject: { full_name: null } })]);
    expect(screen.getByText("No name on file")).toBeInTheDocument();
  });

  it("says so plainly when the subject's profile is gone entirely", () => {
    renderTable([row({ subject: null })]);
    expect(screen.getByText("No name on file")).toBeInTheDocument();
  });

  it("says so plainly when the subject belongs to no client organization", () => {
    renderTable([row({ organization: null })]);
    expect(screen.getByText("None")).toBeInTheDocument();
  });

  it("writes both dates as machine readable times as well", () => {
    renderTable([row()]);
    const entry = rowFor(REQUEST_ID) as HTMLElement;
    const times = within(entry).getAllByText(/2026/);
    expect(times.map((time) => time.getAttribute("datetime"))).toEqual([
      "2026-10-09T08:00:00.000Z",
      "2026-09-09T08:00:00.000Z",
    ]);
  });

  it("renders in German too", () => {
    renderWithIntl(
      <DataRequestsTable rows={[row()]} nextCursor={null} filters={OPEN} now={NOW} />,
      "de-CH",
    );
    expect(screen.getByRole("link", { name: "Datenkopie" })).toBeInTheDocument();
  });
});

/**
 * The badge is the only place the overdue comparison is shown, and it is decided from the server's
 * clock rather than the browser's so every ops user sees the same answer.
 */
describe("the overdue badge (AC-13)", () => {
  it("marks an open row whose deadline has passed", () => {
    renderTable([row()], OPEN, null, new Date("2026-10-10T08:00:00.000Z"));
    expect(screen.getByText("Overdue")).toBeInTheDocument();
  });

  it("leaves a row inside its window unmarked", () => {
    renderTable([row()]);
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("never marks a closed row, however long ago its deadline was", () => {
    renderTable(
      [row({ status: "fulfilled" }), row({ id: OTHER_REQUEST_ID, status: "refused" })],
      { status: "all" },
      null,
      new Date("2027-01-01T00:00:00.000Z"),
    );
    expect(screen.queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("marks only the rows that are actually late", () => {
    renderTable(
      [row(), row({ id: OTHER_REQUEST_ID, due_at: "2027-01-01T00:00:00.000Z" })],
      OPEN,
      null,
      new Date("2026-10-10T08:00:00.000Z"),
    );
    expect(screen.getAllByText("Overdue")).toHaveLength(1);
    expect(within(rowFor(REQUEST_ID) as HTMLElement).getByText("Overdue")).toBeInTheDocument();
  });
});

/**
 * Two different empty states, because they mean opposite things: an empty queue is the goal, an
 * empty filter is a dead end and has to offer the way out.
 */
describe("the empty states (AC-13)", () => {
  it("celebrates an empty queue without offering a filter escape", () => {
    renderTable([], { status: "all" });
    expect(screen.getByText("No data requests")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "All" })).not.toBeInTheDocument();
  });

  it("offers the way out of a filter that matches nothing", () => {
    renderTable([], { status: "refused" });
    expect(screen.getByText("Nothing matches this filter")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All" })).toHaveAttribute(
      "href",
      "/en/admin/data-requests?status=all",
    );
  });

  it("treats the default open queue as a filter, since it hides the closed rows", () => {
    renderTable([], OPEN);
    expect(screen.getByText("Nothing matches this filter")).toBeInTheDocument();
  });
});

describe("paging the queue (AC-13)", () => {
  it("shows no pagination at all on a single page", () => {
    renderTable([row()]);
    expect(screen.queryByRole("link", { name: "Next page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "First page" })).not.toBeInTheDocument();
  });

  it("offers the next page when one exists, carrying the cursor", () => {
    renderTable([row()], OPEN, "Y3Vyc29y");
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/en/admin/data-requests?cursor=Y3Vyc29y",
    );
  });

  it("keeps the filter across a page, so paging never silently widens the list", () => {
    renderTable([row()], { status: "fulfilled" }, "Y3Vyc29y");
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/en/admin/data-requests?status=fulfilled&cursor=Y3Vyc29y",
    );
  });

  it("offers the way back to the first page once past it, dropping the cursor", () => {
    renderTable([row()], { status: "open", cursor: "Y3Vyc29y" }, null);
    expect(screen.getByRole("link", { name: "First page" })).toHaveAttribute(
      "href",
      "/en/admin/data-requests",
    );
  });
});

describe("DataRequestStatusBadge", () => {
  it("names each status", () => {
    const labels = {
      new: "New",
      in_progress: "In progress",
      fulfilled: "Fulfilled",
      refused: "Refused",
    } as const;
    for (const [status, label] of Object.entries(labels)) {
      const view = renderWithIntl(<DataRequestStatusBadge status={status as "new"} />, "en-CH");
      expect(screen.getByText(label)).toBeInTheDocument();
      view.unmount();
    }
  });

  it("outlines a refusal rather than colouring it as a failure", () => {
    // A refusal with a reason on the record is a legitimate answer, not an error state.
    const view = renderWithIntl(<DataRequestStatusBadge status="refused" />, "en-CH");
    expect(screen.getByText("Refused")).toHaveAttribute("data-variant", "outline");
    view.unmount();
    renderWithIntl(<DataRequestStatusBadge status="new" />, "en-CH");
    expect(screen.getByText("New")).not.toHaveAttribute("data-variant", "outline");
  });
});
