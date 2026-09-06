import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateEnquiryResult } from "@/features/enquiries/actions";
import type { Enquiry } from "@/features/enquiries/queries";
import { EnquiriesTable } from "@/features/enquiries/ui/enquiries-table";
import { EnquiryFilterForm } from "@/features/enquiries/ui/enquiry-filters";
import { EnquiryStatusBadge, isEnquiryStatus } from "@/features/enquiries/ui/enquiry-status-badge";
import { EnquiryStatusForm } from "@/features/enquiries/ui/enquiry-status-form";
import { formats, TIME_ZONE } from "@/i18n/formats";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

/**
 * The ops side of the enquiries (spec 0009, AC-12): the list with its columns, links and
 * cursor, the two empty states, the GET filter form, the status badge and the workflow form
 * that saves the status and the note. The server action, the router and the toaster are the
 * boundaries.
 */
const boundary = vi.hoisted(() => ({
  updateEnquiry:
    vi.fn<(previous: UpdateEnquiryResult | null, input: unknown) => Promise<UpdateEnquiryResult>>(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/features/enquiries/actions", () => ({ updateEnquiry: boundary.updateEnquiry }));
vi.mock("sonner", () => ({ toast: { success: boundary.success, error: boundary.error } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: boundary.refresh,
    prefetch: vi.fn(),
  }),
  useParams: () => ({ locale: "en-CH" }),
  usePathname: () => "/en/admin/enquiries",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

type TestLocale = "de-CH" | "en-CH";
const MESSAGES = { "de-CH": de, "en-CH": en } as const;

function renderIn(ui: ReactNode, locale: TestLocale = "en-CH") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={MESSAGES[locale]}
      formats={formats}
      timeZone={TIME_ZONE}
    >
      {ui}
    </NextIntlClientProvider>,
  );
}

const ID = "e0000000-0000-4000-8000-000000000001";
const CURSOR = "Y3Vyc29y";

/** A stored `enquiries` row with every column, overridable per test. */
function enquiry(overrides: Partial<Enquiry> = {}): Enquiry {
  return {
    id: ID,
    topic: "retainer",
    company_name: "Musterfirma AG",
    contact_name: "Clara Muster",
    email: "clara@example.test",
    phone: null,
    headcount_band: "50-249",
    message: "We run three sites and need a partner for the audits.",
    locale: "de",
    status: "new",
    ops_note: null,
    handled_by: null,
    handled_at: null,
    organization_id: null,
    submitted_by: null,
    ip_hash: null,
    created_at: "2026-09-06T08:30:00.000+00:00",
    updated_at: "2026-09-06T08:30:00.000+00:00",
    ...overrides,
  };
}

const labels = en.enquiries;

beforeEach(() => {
  boundary.updateEnquiry.mockResolvedValue({ ok: true, data: { id: ID } } as UpdateEnquiryResult);
});

describe("EnquiryStatusBadge (AC-12)", () => {
  it("labels each status in the reader's language and marks the element with the status", () => {
    renderIn(
      <>
        <EnquiryStatusBadge status="new" />
        <EnquiryStatusBadge status="contacted" />
        <EnquiryStatusBadge status="closed" />
      </>,
      "de-CH",
    );
    expect(screen.getByText(de.enquiries.status.new)).toHaveAttribute("data-status", "new");
    expect(screen.getByText(de.enquiries.status.contacted)).toHaveAttribute(
      "data-status",
      "contacted",
    );
    expect(screen.getByText(de.enquiries.status.closed)).toHaveAttribute("data-status", "closed");
  });

  it("shows an unknown stored value as it is rather than crashing", () => {
    renderIn(<EnquiryStatusBadge status="archived" />);
    expect(screen.getByText("archived")).not.toHaveAttribute("data-status");
    expect(isEnquiryStatus("archived")).toBe(false);
    expect(isEnquiryStatus("closed")).toBe(true);
  });
});

describe("EnquiriesTable (AC-12)", () => {
  it("lists received, topic, company, contact and status with the company linking to the detail", () => {
    renderIn(
      <EnquiriesTable
        rows={[
          enquiry(),
          enquiry({ id: ID.replace(/1$/, "2"), topic: "general", status: "closed" }),
        ]}
        nextCursor={null}
        filters={{ status: "all" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(labels.listHeading);
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      labels.columns.received,
      labels.columns.topic,
      labels.columns.company,
      labels.columns.contact,
      labels.columns.status,
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    const first = rows[0];
    if (!first) throw new Error("no rows");
    expect(first).toHaveAttribute("data-enquiry-id", ID);
    expect(first.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-06T08:30:00.000+00:00",
    );
    // The Swiss time zone: 08:30 UTC in September is 10:30 in Zurich.
    expect(first.querySelector("time")).toHaveTextContent(/10:30/);
    expect(first).toHaveTextContent(labels.topics.retainer);
    expect(first).toHaveTextContent("Clara Muster");
    expect(first.querySelector("[data-status]")).toHaveAttribute("data-status", "new");
    expect(screen.getAllByRole("link", { name: "Musterfirma AG" })[0]).toHaveAttribute(
      "href",
      `/en/admin/enquiries/${ID}`,
    );
    expect(rows[1]).toHaveTextContent(labels.topics.general);
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows the inbox empty state when every status is listed and nothing exists", () => {
    renderIn(<EnquiriesTable rows={[]} nextCursor={null} filters={{ status: "all" }} />);
    expect(screen.getByText(labels.empty.title)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: labels.filters.all })).toBeNull();
  });

  it("says the filter has no matches and offers all statuses when a status filter is set", () => {
    renderIn(<EnquiriesTable rows={[]} nextCursor={null} filters={{ status: "contacted" }} />);
    expect(screen.getByText(labels.noResults.title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: labels.filters.all })).toHaveAttribute(
      "href",
      "/en/admin/enquiries?status=all",
    );
  });

  it("links the next page with the filter and the cursor, and the first page while on a later one", () => {
    renderIn(
      <EnquiriesTable
        rows={[enquiry()]}
        nextCursor={CURSOR}
        filters={{ status: "closed", cursor: "previous" }}
      />,
    );
    const pager = screen.getByRole("navigation", { name: labels.listHeading });
    expect(screen.getByRole("link", { name: labels.pagination.next })).toHaveAttribute(
      "href",
      `/en/admin/enquiries?status=closed&cursor=${CURSOR}`,
    );
    expect(screen.getByRole("link", { name: labels.pagination.first })).toHaveAttribute(
      "href",
      "/en/admin/enquiries?status=closed",
    );
    expect(pager).toBeInTheDocument();
  });

  it("drops the default status from the next page link", () => {
    renderIn(<EnquiriesTable rows={[enquiry()]} nextCursor={CURSOR} filters={{ status: "new" }} />);
    expect(screen.getByRole("link", { name: labels.pagination.next })).toHaveAttribute(
      "href",
      `/en/admin/enquiries?cursor=${CURSOR}`,
    );
    expect(screen.queryByRole("link", { name: labels.pagination.first })).toBeNull();
  });
});

describe("EnquiryFilterForm (AC-12)", () => {
  it("is a GET form with the current status preselected, an apply button and a reset link", () => {
    const { container } = renderIn(<EnquiryFilterForm filters={{ status: "contacted" }} />);
    expect(container.querySelector("form")).toHaveAttribute("method", "get");
    expect(screen.getByRole("group", { name: labels.filters.legend })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: labels.filters.status })).toHaveTextContent(
      labels.status.contacted,
    );
    expect(container.querySelector('select[name="status"]')).toHaveValue("contacted");
    expect(screen.getByRole("button", { name: labels.filters.apply })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.getByRole("link", { name: labels.filters.reset })).toHaveAttribute(
      "href",
      "/en/admin/enquiries",
    );
  });

  it("offers the three statuses and all", () => {
    const { container } = renderIn(<EnquiryFilterForm filters={{ status: "all" }} />);
    const options = Array.from(container.querySelectorAll('select[name="status"] option')).map(
      (option) => option.getAttribute("value"),
    );
    expect(options).toEqual(["new", "contacted", "closed", "all"]);
    expect(screen.getByRole("combobox", { name: labels.filters.status })).toHaveTextContent(
      labels.filters.all,
    );
  });
});

describe("EnquiryStatusForm (AC-12)", () => {
  it("shows the stored status and note with the note described by its hint", () => {
    renderIn(<EnquiryStatusForm id={ID} status="contacted" opsNote="Called on Monday." />);
    expect(screen.getByRole("combobox", { name: labels.form.status })).toHaveTextContent(
      labels.status.contacted,
    );
    const note = screen.getByRole("textbox", { name: labels.form.opsNote });
    expect(note).toHaveValue("Called on Monday.");
    expect(note).toHaveAccessibleDescription(labels.form.opsNoteHint);
    expect(screen.getByRole("button", { name: labels.form.submit })).toBeEnabled();
  });

  it("saves the id, the status, the trimmed note and the locale, then toasts and refreshes", async () => {
    const user = userEvent.setup();
    renderIn(<EnquiryStatusForm id={ID} status="new" opsNote={null} />);
    await user.type(screen.getByRole("textbox", { name: labels.form.opsNote }), "  Called back  ");
    await user.click(screen.getByRole("button", { name: labels.form.submit }));

    await waitFor(() => expect(boundary.updateEnquiry).toHaveBeenCalledTimes(1));
    expect(boundary.updateEnquiry.mock.calls[0]?.[1]).toEqual({
      id: ID,
      status: "new",
      opsNote: "Called back",
      locale: "en-CH",
    });
    await waitFor(() => expect(boundary.success).toHaveBeenCalledWith(labels.form.saved));
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });

  it("sends null for an empty note", async () => {
    const user = userEvent.setup();
    renderIn(<EnquiryStatusForm id={ID} status="closed" opsNote={null} />);
    await user.click(screen.getByRole("button", { name: labels.form.submit }));
    await waitFor(() => expect(boundary.updateEnquiry).toHaveBeenCalledTimes(1));
    expect(boundary.updateEnquiry.mock.calls[0]?.[1]).toMatchObject({
      status: "closed",
      opsNote: null,
    });
  });

  it("refuses a note over 2000 characters next to the field without calling the action", async () => {
    const user = userEvent.setup();
    renderIn(<EnquiryStatusForm id={ID} status="new" opsNote={null} />);
    const note = screen.getByRole("textbox", { name: labels.form.opsNote });
    await user.click(note);
    await user.paste("x".repeat(2001));
    await user.click(screen.getByRole("button", { name: labels.form.submit }));
    await waitFor(() => expect(note).toHaveAttribute("aria-invalid", "true"));
    expect(note).toHaveAccessibleDescription(labels.form.errors.noteLong);
    expect(boundary.updateEnquiry).not.toHaveBeenCalled();
    expect(boundary.success).not.toHaveBeenCalled();
  });

  it("announces an action error in the reader's words and neither toasts nor refreshes", async () => {
    const user = userEvent.setup();
    boundary.updateEnquiry.mockResolvedValue({ ok: false, error: "not_found" });
    renderIn(<EnquiryStatusForm id={ID} status="new" opsNote={null} />);
    await user.click(screen.getByRole("button", { name: labels.form.submit }));
    expect(await screen.findByText(labels.form.errors.not_found)).toBeInTheDocument();
    expect(boundary.success).not.toHaveBeenCalled();
    expect(boundary.refresh).not.toHaveBeenCalled();
  });

  it("names the forbidden and unavailable errors too", async () => {
    const user = userEvent.setup();
    boundary.updateEnquiry.mockResolvedValue({ ok: false, error: "forbidden" });
    renderIn(<EnquiryStatusForm id={ID} status="new" opsNote={null} />);
    await user.click(screen.getByRole("button", { name: labels.form.submit }));
    expect(await screen.findByText(labels.form.errors.forbidden)).toBeInTheDocument();
  });
});
