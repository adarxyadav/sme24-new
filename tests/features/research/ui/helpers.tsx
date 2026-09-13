import { screen, waitFor } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { expect } from "vitest";
import type { ResearchActionResult } from "@/features/research/actions";
import type { KpiDefinitionRow } from "@/features/research/queries";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { countryName } from "@/lib/countries";
import { en } from "../../emails/ui/helpers";

export { de, en, renderWithIntl } from "../../emails/ui/helpers";

/** A `wrapper` for `render` so `rerender` keeps the English catalog around the component. */
export function EnglishIntl({ children }: { readonly children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en-CH" messages={en} formats={formats} timeZone={TIME_ZONE}>
      {children}
    </NextIntlClientProvider>
  );
}

export const COMPANY_ID = "0c000000-0000-4000-8000-00000000000a";
export const RUN_ID = "0d000000-0000-4000-8000-000000000001";

/** An unresolved action result so a test can settle the pending state by hand. */
export function deferred<Data>() {
  let resolve: (result: ResearchActionResult<Data>) => void = () => {};
  const promise = new Promise<ResearchActionResult<Data>>((settle) => {
    resolve = settle;
  });
  return { promise, resolve: (result: ResearchActionResult<Data>) => resolve(result) };
}

/** A `kpi_definitions` row as the query returns it, with both language names. */
export function definition(
  key: string,
  overrides: Partial<KpiDefinitionRow> = {},
): KpiDefinitionRow {
  return {
    key,
    name: { de: `${key} (de)`, en: `${key} (en)` },
    description: { de: `Beschreibung ${key}`, en: `Description ${key}` },
    unit: "per 1 000 000 hours",
    direction: "lower_is_better",
    sort_order: 1,
    is_active: true,
    created_at: "2026-09-06T00:00:00.000Z",
    updated_at: "2026-09-06T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Picks a country in a `CountrySelect` (spec 0022, AC-1): opens the trigger by its accessible
 * name and clicks the option named for the code, as `Intl.DisplayNames` renders it in the given
 * locale.
 */
export async function pickCountry(
  user: UserEvent,
  triggerName: string,
  code: string,
  locale: "de" | "en" = "en",
): Promise<void> {
  const trigger = screen.getByRole("combobox", { name: triggerName });
  await user.click(trigger);
  // Radix types ahead to the option whose text starts with what was typed, which is how a user
  // finds one country among 249; clicking is not an option in jsdom, where the list has no
  // layout and only the options around the highlighted one are rendered.
  const name = countryName(code, locale);
  await user.keyboard(name);
  await user.keyboard("{Enter}");
  await waitFor(() => expect(trigger).toHaveTextContent(name));
}
