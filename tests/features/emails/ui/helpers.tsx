import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { Delivery } from "@/features/emails/queries";
import { formats, TIME_ZONE } from "@/i18n/formats";
import de from "../../../../messages/de-CH.json";
import en from "../../../../messages/en-CH.json";

export { de, en };

export type TestLocale = "de-CH" | "en-CH";
const MESSAGES = { "de-CH": de, "en-CH": en } as const;

/** Renders under the app's next-intl setup: the catalog, the named formats and the Swiss time zone. */
export function renderWithIntl(ui: ReactNode, locale: TestLocale = "de-CH") {
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

export const DELIVERY_ID = "d0000000-0000-4000-8000-000000000001";

/** A stored `email_deliveries` row with every column, overridable per test. */
export function delivery(overrides: Partial<Delivery> = {}): Delivery {
  return {
    id: DELIVERY_ID,
    idempotency_key: "welcome/org",
    source_event: "auth.organization_created",
    template: "welcome",
    locale: "de",
    recipient_email: "clara@example.test",
    recipient_id: "11111111-1111-4111-8111-111111111111",
    organization_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    subject: "Willkommen bei SME24, Musterfirma AG",
    data: { organizationName: "Musterfirma AG" },
    status: "sent",
    transport: "smtp",
    attempts: 1,
    last_run_id: "run_1",
    provider_message_id: null,
    error: null,
    sent_at: "2026-09-05T10:00:01.000+00:00",
    delivered_at: null,
    failed_at: null,
    created_at: "2026-09-05T10:00:00.000+00:00",
    updated_at: "2026-09-05T10:00:01.000+00:00",
    ...overrides,
  };
}
