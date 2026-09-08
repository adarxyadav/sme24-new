import { render, screen, within } from "@testing-library/react";
import { createFormatter, createTranslator, NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ScheduledAssessments } from "@/features/ops-admin/ui/scheduled-assessments";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { assessment, assigned, en, NINA, UELI } from "./helpers";

/**
 * The client's "Your assessment" card (spec 0014, AC-10). The rule the card exists to keep is that
 * each booked order shows its own date and its own assessor: an organization holding two bookings
 * with two different people must not see one of them twice. The server translator and formatter
 * are the boundaries.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "en-CH", messages: en, namespace: namespace as never, formats }),
  getFormatter: async () => createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE }),
}));

const strings = en.orders.assessment;
const format = createFormatter({ locale: "en-CH", formats, timeZone: TIME_ZONE });

/** The date exactly as the card prints it, so a test never hard codes a zone offset. */
const shown = (iso: string) => format.dateTime(new Date(iso), "dateTime");

function wrap(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
      {ui}
    </NextIntlClientProvider>,
  );
}

async function renderCard(
  assessments: Parameters<typeof ScheduledAssessments>[0]["assessments"],
  experts: Parameters<typeof ScheduledAssessments>[0]["experts"] = [assigned(NINA, "Nina Keller")],
) {
  return wrap(await ScheduledAssessments({ assessments, experts }));
}

describe("when there is nothing booked", () => {
  // Absent, not empty: an empty state here would tell every client without a booking that they are
  // missing something they never bought.
  it("renders no section at all rather than an empty one", async () => {
    const { container } = await renderCard([]);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a single booking (AC-10)", () => {
  it("names the package, the date and the assessor going", async () => {
    await renderCard([assessment()]);

    expect(screen.getByRole("heading", { name: "Your assessment" })).toBeInTheDocument();
    expect(screen.getByText("Assessment Plus")).toBeInTheDocument();
    expect(screen.getByText(shown("2026-10-14T07:30:00.000Z"))).toBeInTheDocument();
    expect(screen.getByText("With Nina Keller")).toBeInTheDocument();
  });

  // The instant is carried in `dateTime` as stored, so the reader's own machine and any assistive
  // technology can read the booking independently of how it was printed.
  it("carries the stored instant on the time element", async () => {
    await renderCard([assessment()]);
    const time = screen.getByText(shown("2026-10-14T07:30:00.000Z"));
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("dateTime", "2026-10-14T07:30:00.000Z");
  });

  it("shows the order reference so the client can quote it", async () => {
    await renderCard([assessment()]);
    expect(screen.getByText("SME24-2026-0042")).toBeInTheDocument();
  });

  it("shows the assessor's headline when they have one", async () => {
    await renderCard(
      [assessment()],
      [assigned(NINA, "Nina Keller", { headline: "Safety engineer, 20 years" })],
    );
    expect(screen.getByText("Safety engineer, 20 years")).toBeInTheDocument();
  });

  it("reads the status from the shared order catalog", async () => {
    await renderCard([assessment()]);
    expect(screen.getByText(en.orders.status.scheduled)).toBeInTheDocument();
  });

  it("marks a delivered booking as delivered", async () => {
    await renderCard([assessment({ status: "delivered" })]);
    expect(screen.getByText(en.orders.status.delivered)).toBeInTheDocument();
  });
});

describe("matching each booking to its own assessor (AC-10)", () => {
  // The bug this rules out: taking the organization's first expert, or matching by position, would
  // show the same person on both rows.
  it("gives two bookings their own expert and their own date", async () => {
    await renderCard(
      [
        assessment(),
        assessment({
          orderId: "0a000000-0000-4000-8000-000000000002",
          reference: "SME24-2026-0043",
          packageName: "Assessment Basic",
          scheduledAt: "2026-11-20T13:00:00.000Z",
          expertId: UELI,
        }),
      ],
      [assigned(NINA, "Nina Keller"), assigned(UELI, "Ueli Roth")],
    );

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("With Nina Keller")).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByText(shown("2026-10-14T07:30:00.000Z")),
    ).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("With Ueli Roth")).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText(shown("2026-11-20T13:00:00.000Z")),
    ).toBeInTheDocument();
  });

  // The order of the summaries is not the order of the bookings, so the match has to be by id.
  it("matches by id however the summaries are ordered", async () => {
    await renderCard(
      [assessment({ expertId: UELI })],
      [assigned(NINA, "Nina Keller"), assigned(UELI, "Ueli Roth")],
    );
    expect(screen.getByText("With Ueli Roth")).toBeInTheDocument();
    expect(screen.queryByText("With Nina Keller")).not.toBeInTheDocument();
  });

  // The booking is the fact the client needs: an assignment ended after the visit must not take
  // the date off the page.
  it("still shows the date when the assessor is no longer among the summaries", async () => {
    await renderCard([assessment()], []);

    expect(screen.getByText(shown("2026-10-14T07:30:00.000Z"))).toBeInTheDocument();
    expect(screen.getByText(strings.expertPending)).toBeInTheDocument();
  });

  it("falls back to a neutral name for an assessor with no full name", async () => {
    await renderCard([assessment()], [assigned(NINA, null)]);
    expect(screen.getByText(`With ${strings.unnamed}`)).toBeInTheDocument();
  });
});

describe("how the section reads", () => {
  it("titles itself for one booking and for several", async () => {
    const { unmount } = await renderCard([assessment()]);
    expect(screen.getByRole("heading", { name: "Your assessment" })).toBeInTheDocument();
    unmount();

    await renderCard(
      [assessment(), assessment({ orderId: "0a000000-0000-4000-8000-000000000002" })],
      [assigned(NINA, "Nina Keller")],
    );
    expect(screen.getByRole("heading", { name: "Your assessments" })).toBeInTheDocument();
  });

  it("is a landmark named by its own heading, so it can be skipped to", async () => {
    await renderCard([assessment()]);
    const region = screen.getByRole("region", { name: "Your assessment" });
    expect(region).toBeInTheDocument();
  });

  it("lists the bookings, so a screen reader announces how many there are", async () => {
    await renderCard(
      [assessment(), assessment({ orderId: "0a000000-0000-4000-8000-000000000002" })],
      [assigned(NINA, "Nina Keller")],
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
