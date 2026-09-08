import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { OrderActions } from "@/features/checkout/ui/order-actions";
import de from "../../../messages/de-CH.json";
import en from "../../../messages/en-CH.json";

vi.mock("@/features/checkout/ops-actions", () => ({
  cancelOrder: vi.fn(),
  markOrderPaid: vi.fn(),
  retryInvoiceRender: vi.fn(),
}));

const reference = "SME24-2026-0042";
for (const [locale, messages, cancellation, payment] of [
  ["en-CH", en, /cancel order/i, /payment.*arrived/i],
  ["de-CH", de, /bestellung.*stornieren/i, /zahlungseingang/i],
] as const) {
  describe(`pending order cancellation in ${locale} (AC-9)`, () => {
    it("describes cancellation with the reference and requires a nonblank reason", async () => {
      const user = userEvent.setup();
      const strings = messages.adminOrders;
      render(
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Zurich">
          <OrderActions
            orderId="0e000000-0000-4000-8000-000000000042"
            reference={reference}
            status="pending"
            invoiceId={null}
            renderFailed={false}
          />
        </NextIntlClientProvider>,
      );
      const trigger = screen.getByRole("button", { name: strings.cancel });
      await user.click(trigger);
      const dialog = screen.getByRole("dialog", { name: strings.cancelConfirm });
      expect(dialog).toHaveAccessibleDescription(
        strings.cancelDescription.replace("{reference}", reference),
      );
      expect(dialog).toHaveAccessibleDescription(cancellation);
      expect(dialog).toHaveAccessibleDescription(expect.stringContaining(reference));
      expect(dialog).not.toHaveAccessibleDescription(payment);
      const reason = within(dialog).getByRole("textbox", { name: strings.cancelReason });
      const confirm = within(dialog).getByRole("button", { name: strings.cancelConfirm });
      expect(reason).toBeVisible();
      expect(confirm).toBeDisabled();
      await user.type(reason, "   ");
      expect(confirm).toBeDisabled();
      await user.type(reason, "Client withdrew");
      expect(confirm).toBeEnabled();
      await user.clear(reason);
      expect(confirm).toBeDisabled();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
}
