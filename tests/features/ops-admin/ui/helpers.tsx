import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import type { AssignedExpertSummary } from "@/features/experts/queries";
import type { AssignableExpert, ScheduledAssessment } from "@/features/ops-admin/queries";

export { de, en, renderWithIntl } from "../../emails/ui/helpers";

/**
 * The two jsdom gaps `cmdk` falls into, installed per file rather than in `tests/setup.ts`:
 * `tests/chart.test.tsx` depends on `ResizeObserver` being absent, because that absence is what
 * keeps Recharts at the size it was given, so a global shim would quietly break it.
 *
 * Call this once at the top of a file that renders the searchable Combobox.
 */
export function stubComboboxEnvironment() {
  if (typeof globalThis.ResizeObserver !== "function") {
    class NoopResizeObserver implements ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: NoopResizeObserver,
    });
  }
  // jsdom implements no layout, so it has no `scrollIntoView`; cmdk calls it whenever the
  // highlighted option changes.
  if (typeof Element !== "undefined" && typeof Element.prototype.scrollIntoView !== "function") {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
  }
}

export const ORDER_ID = "0a000000-0000-4000-8000-000000000001";
export const REFERENCE = "SME24-2026-0042";

export const NINA = "0e000000-0000-4000-8000-00000000000a";
export const UELI = "0e000000-0000-4000-8000-00000000000b";

/** An `active` expert as `listAssignableExperts` returns it for the picker. */
export function assignable(
  expertId: string,
  fullName: string | null,
  headline: string | null = null,
): AssignableExpert {
  return { expertId, fullName, headline };
}

/** The two assessors every dialog test picks between. */
export const EXPERTS: readonly AssignableExpert[] = [
  assignable(NINA, "Nina Keller", "Safety engineer"),
  assignable(UELI, "Ueli Roth"),
];

/** A booked order as `listScheduledAssessments` hands it to the client card. */
export function assessment(overrides: Partial<ScheduledAssessment> = {}): ScheduledAssessment {
  return {
    orderId: ORDER_ID,
    reference: REFERENCE,
    packageName: "Assessment Plus",
    status: "scheduled",
    scheduledAt: "2026-10-14T07:30:00.000Z",
    expertId: NINA,
    ...overrides,
  };
}

/** An organization's assigned expert as `listAssignedExperts` returns it. */
export function assigned(
  expertId: string,
  fullName: string | null,
  overrides: Partial<AssignedExpertSummary> = {},
): AssignedExpertSummary {
  return {
    assignmentId: `a${expertId.slice(1)}`,
    expertId,
    fullName,
    headline: null,
    bio: null,
    competencies: [],
    industries: [],
    standards: [],
    languages: [],
    startedAt: "2026-09-01T00:00:00.000Z",
    photoUrl: null,
    ...overrides,
  };
}

/**
 * Picks an assessor in the searchable combobox: the trigger opens the list, the option is chosen
 * by its name. Scoped to the open dialog, because a page may carry a picker per order row.
 */
export async function chooseExpert(
  user: ReturnType<typeof userEvent.setup>,
  name: string | RegExp,
  root: HTMLElement = document.body,
) {
  const scope = within(root);
  await user.click(scope.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name }));
}

/** Replaces the wall clock time in a `datetime-local` field, clearing whatever it was seeded with. */
export async function setDateTime(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  value: string,
) {
  await user.clear(field);
  await user.type(field, value);
}
