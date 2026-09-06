import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import type { ResearchActionResult } from "@/features/research/actions";
import type { KpiDefinitionRow } from "@/features/research/queries";
import { formats, TIME_ZONE } from "@/i18n/formats";
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
