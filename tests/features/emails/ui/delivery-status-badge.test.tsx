import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DeliveryStatusBadge, isDeliveryStatus } from "@/features/emails/ui/delivery-status-badge";
import { DELIVERY_STATUSES } from "@/lib/email/schema";
import { de, en, renderWithIntl } from "./helpers";

/**
 * The status badge (spec 0006, AC-9): every one of the eight statuses has a label in both
 * languages, the status is exposed as data for the live table, and a value the catalog does not
 * know is shown as is rather than crashing the list.
 */
describe("DeliveryStatusBadge (AC-9)", () => {
  it.each(DELIVERY_STATUSES)("labels %s in German", (status) => {
    renderWithIntl(<DeliveryStatusBadge status={status} />);
    expect(screen.getByText(de.emails.status[status])).toHaveAttribute("data-status", status);
  });

  it.each(DELIVERY_STATUSES)("labels %s in English", (status) => {
    renderWithIntl(<DeliveryStatusBadge status={status} />, "en-CH");
    expect(screen.getByText(en.emails.status[status])).toBeInTheDocument();
  });

  it("shows an unknown status as plain text without a status attribute", () => {
    renderWithIntl(<DeliveryStatusBadge status="archived" />);
    const badge = screen.getByText("archived");
    expect(badge).not.toHaveAttribute("data-status");
  });

  it("recognises exactly the eight statuses", () => {
    for (const status of DELIVERY_STATUSES) expect(isDeliveryStatus(status)).toBe(true);
    expect(isDeliveryStatus("archived")).toBe(false);
    expect(isDeliveryStatus("")).toBe(false);
    expect(isDeliveryStatus("toString")).toBe(false);
  });
});
