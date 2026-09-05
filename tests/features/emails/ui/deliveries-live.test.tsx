import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Delivery } from "@/features/emails/queries";
import { DeliveriesLive } from "@/features/emails/ui/deliveries-live";
import { de, delivery, renderWithIntl } from "./helpers";

/**
 * The live deliveries table (spec 0006, AC-9): rows link to their detail page, the badge says
 * whether Realtime is connected, an UPDATE patches only a row already on the page, the polling
 * fallback refreshes every 5 seconds until the channel is live, the two empty states differ by
 * whether a filter is set, and the keyset links keep the filters. The browser Supabase client and
 * the App Router are the boundaries.
 */
const realtime = vi.hoisted(() => ({
  handler: null as null | ((payload: { new: unknown }) => void),
  subscribe: null as null | ((status: string) => void),
  session: { access_token: "tok" } as null | { access_token: string },
  setAuth: vi.fn(),
  removeChannel: vi.fn(),
  unsubscribeAuth: vi.fn(),
  refresh: vi.fn(),
  channelName: "",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: realtime.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "de-CH" }),
  usePathname: () => "/de/admin/emails",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createBrowserSupabaseClient: () => {
    const channel = {
      on: (_event: string, _filter: unknown, handler: (payload: { new: unknown }) => void) => {
        realtime.handler = handler;
        return channel;
      },
      subscribe: (callback: (status: string) => void) => {
        realtime.subscribe = callback;
        return channel;
      },
    };
    return {
      channel: (name: string) => {
        realtime.channelName = name;
        return channel;
      },
      auth: {
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: realtime.unsubscribeAuth } },
        }),
        getSession: async () => ({ data: { session: realtime.session } }),
      },
      realtime: { setAuth: realtime.setAuth },
      removeChannel: realtime.removeChannel,
    };
  },
}));

const SECOND_ID = "d0000000-0000-4000-8000-000000000002";
const rows: readonly Delivery[] = [
  delivery(),
  delivery({
    id: SECOND_ID,
    recipient_email: "ops@sme24.example",
    status: "failed",
    error: "boom",
    source_event: "ops.test_email",
    created_at: "2026-09-04T13:05:00.000+00:00",
  }),
];

function renderTable(props: Partial<Parameters<typeof DeliveriesLive>[0]> = {}) {
  return renderWithIntl(
    <DeliveriesLive initialRows={rows} nextCursor={null} filters={{}} {...props} />,
  );
}

async function goLive() {
  await waitFor(() => expect(realtime.subscribe).not.toBeNull());
  act(() => realtime.subscribe?.("SUBSCRIBED"));
}

beforeEach(() => {
  realtime.handler = null;
  realtime.subscribe = null;
  realtime.session = { access_token: "tok" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("DeliveriesLive (AC-9)", () => {
  it("lists every row with a link to its detail page, the template, the status, the event and the Zurich time", () => {
    renderTable();
    const table = screen.getByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    const [first, second] = bodyRows;
    if (!first || !second) throw new Error("expected two rows");
    expect(within(first).getByRole("link", { name: "clara@example.test" })).toHaveAttribute(
      "href",
      `/de/admin/emails/${delivery().id}`,
    );
    expect(within(first).getByText("welcome")).toBeInTheDocument();
    expect(within(first).getByText(de.emails.status.sent)).toHaveAttribute("data-status", "sent");
    expect(within(first).getByText("auth.organization_created")).toBeInTheDocument();
    expect(within(first).getByText("05.09.2026, 12:00")).toHaveAttribute(
      "datetime",
      "2026-09-05T10:00:00.000+00:00",
    );
    expect(within(second).getByText(de.emails.status.failed)).toBeInTheDocument();
    expect(within(second).getByText("04.09.2026, 15:05")).toBeInTheDocument();
  });

  it("subscribes to email_deliveries with the session token and switches the badge from polling to live", async () => {
    renderTable();
    expect(screen.getByText(de.emails.polling)).toHaveAttribute("data-live", "false");
    await goLive();
    expect(realtime.channelName).toBe("email_deliveries");
    expect(realtime.setAuth).toHaveBeenCalledWith("tok");
    expect(realtime.setAuth.mock.invocationCallOrder[0]).toBeDefined();
    expect(screen.getByText(de.emails.live)).toHaveAttribute("data-live", "true");
  });

  it("falls back to polling again when the channel drops", async () => {
    renderTable();
    await goLive();
    act(() => realtime.subscribe?.("CHANNEL_ERROR"));
    expect(screen.getByText(de.emails.polling)).toBeInTheDocument();
  });

  it("patches a row already on the page from an UPDATE and ignores a row it does not show", async () => {
    renderTable();
    await waitFor(() => expect(realtime.handler).not.toBeNull());
    act(() => realtime.handler?.({ new: delivery({ status: "delivered" }) }));
    expect(screen.getByText(de.emails.status.delivered)).toHaveAttribute(
      "data-status",
      "delivered",
    );
    expect(screen.queryByText(de.emails.status.sent)).not.toBeInTheDocument();

    act(() =>
      realtime.handler?.({
        new: delivery({ id: "d0000000-0000-4000-8000-000000000099", status: "queued" }),
      }),
    );
    expect(within(screen.getByRole("table")).getAllByRole("row").slice(1)).toHaveLength(2);
    expect(screen.queryByText(de.emails.status.queued)).not.toBeInTheDocument();
  });

  it("refreshes the page every 5 seconds while not live and stops once the channel is live", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderTable();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(realtime.refresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(realtime.refresh).toHaveBeenCalledTimes(2);

    await goLive();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(realtime.refresh).toHaveBeenCalledTimes(2);
  });

  it("shows the empty outbox without filters and the no results state with a reset link when filtered", () => {
    const { unmount } = renderTable({ initialRows: [] });
    expect(screen.getByText(de.emails.empty.title)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    unmount();

    renderTable({ initialRows: [], filters: { status: "failed" } });
    expect(screen.getByText(de.emails.noResults.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: de.emails.filters.reset })).toHaveAttribute(
      "href",
      "/de/admin/emails",
    );
  });

  it("links the next page with the filters and the cursor, and the first page with the filters only", () => {
    renderTable({ nextCursor: "cursor-2", filters: { status: "failed", q: "clara" } });
    expect(screen.getByRole("link", { name: de.emails.pagination.next })).toHaveAttribute(
      "href",
      "/de/admin/emails?status=failed&q=clara&cursor=cursor-2",
    );
    expect(
      screen.queryByRole("link", { name: de.emails.pagination.first }),
    ).not.toBeInTheDocument();
  });

  it("offers the first page from a later page and no pager at all on a single page", () => {
    const { unmount } = renderTable({ filters: { status: "failed", cursor: "cursor-2" } });
    expect(screen.getByRole("link", { name: de.emails.pagination.first })).toHaveAttribute(
      "href",
      "/de/admin/emails?status=failed",
    );
    expect(screen.queryByRole("link", { name: de.emails.pagination.next })).not.toBeInTheDocument();
    unmount();

    renderTable();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("removes the channel and the auth listener on unmount", async () => {
    const { unmount } = renderTable();
    await goLive();
    unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(realtime.unsubscribeAuth).toHaveBeenCalledTimes(1);
  });
});
