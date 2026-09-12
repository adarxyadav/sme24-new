import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SetSectionExclusionResult } from "@/features/assessments/actions";
import {
  SectionExclusion,
  type SectionExclusionProps,
} from "@/features/assessments/ui/section-exclusion";
import { ASSESSMENT_ID, en, renderWithIntl } from "./helpers";

/**
 * The Not applicable control of one standard (spec 0019, AC-8): a labelled switch described by
 * its lead, a reason field only while excluded, the switch saving at once and the reason after a
 * pause or on blur through one in flight queue, a page refresh after every landed save, and a
 * locked answer that freezes the control. The server action, the router and the toaster are the
 * boundaries.
 */
const boundary = vi.hoisted(() => ({
  setSectionExclusion:
    vi.fn<(previous: null, input: unknown) => Promise<SetSectionExclusionResult>>(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/assessments/actions", () => ({
  setSectionExclusion: boundary.setSectionExclusion,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: boundary.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: boundary.toastError, success: vi.fn() } }));

const strings = en.assessments.exclusion;
const ok = (excluded: boolean): SetSectionExclusionResult => ({
  ok: true,
  data: { sectionKey: "hot_work", excluded },
});

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderControl(overrides: Partial<SectionExclusionProps> = {}) {
  const props: SectionExclusionProps = {
    assessmentId: ASSESSMENT_ID,
    sectionKey: "hot_work",
    excluded: false,
    note: null,
    readOnly: false,
    ...overrides,
  };
  return renderWithIntl(<SectionExclusion {...props} />, "en-CH");
}

const payload = (excluded: boolean, note = "") => ({
  assessmentId: ASSESSMENT_ID,
  sectionKey: "hot_work",
  excluded,
  note,
});

let user: ReturnType<typeof userEvent.setup>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  // Testing Library drains its async wrapper through a `setTimeout` and advances only timers it
  // recognises as Jest's, so it is handed the Vitest clock under that name for the file.
  Object.defineProperty(globalThis, "jest", {
    configurable: true,
    value: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
  });
  user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  boundary.setSectionExclusion.mockReset();
  boundary.refresh.mockReset();
  boundary.toastError.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "jest");
});

describe("SectionExclusion (AC-8)", () => {
  it("is a labelled switch described by the lead, with no reason field while the standard applies", () => {
    renderControl();
    const toggle = screen.getByRole("switch", { name: strings.label });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAccessibleDescription(strings.lead);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "idle");
  });

  it("excluding saves at once, swaps the lead for the hint, opens the reason field and refreshes the page once it lands", async () => {
    boundary.setSectionExclusion.mockResolvedValue(ok(true));
    const { container } = renderControl();
    await user.click(screen.getByRole("switch"));

    expect(boundary.setSectionExclusion).toHaveBeenCalledWith(null, payload(true));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch")).toHaveAccessibleDescription(strings.excludedHint);
    expect(container.querySelector("[data-section-exclusion]")).toHaveAttribute(
      "data-excluded",
      "true",
    );
    const reason = screen.getByRole("textbox", { name: strings.note });
    expect(reason).toHaveAttribute("placeholder", strings.notePlaceholder);
    expect(reason).toHaveAccessibleDescription(strings.noteHint);

    await tick();
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "saved");
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });

  it("including again saves excluded false and closes the reason field", async () => {
    boundary.setSectionExclusion.mockResolvedValue(ok(false));
    renderControl({ excluded: true, note: "Welding is contracted out" });
    expect(screen.getByRole("textbox", { name: strings.note })).toHaveValue(
      "Welding is contracted out",
    );
    await user.click(screen.getByRole("switch"));
    expect(boundary.setSectionExclusion).toHaveBeenCalledWith(
      null,
      payload(false, "Welding is contracted out"),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("saves the reason 800 ms after the last keystroke, or on blur", async () => {
    boundary.setSectionExclusion.mockResolvedValue(ok(true));
    renderControl({ excluded: true });
    const reason = screen.getByRole("textbox", { name: strings.note });

    await user.type(reason, "No hot work");
    expect(screen.getByRole("status")).toHaveTextContent(en.assessments.save.pending);
    expect(boundary.setSectionExclusion).not.toHaveBeenCalled();
    await tick(800);
    expect(boundary.setSectionExclusion).toHaveBeenCalledTimes(1);
    expect(boundary.setSectionExclusion).toHaveBeenCalledWith(null, payload(true, "No hot work"));

    await user.type(reason, " here");
    await user.tab();
    expect(boundary.setSectionExclusion).toHaveBeenCalledTimes(2);
    expect(boundary.setSectionExclusion).toHaveBeenLastCalledWith(
      null,
      payload(true, "No hot work here"),
    );
  });

  it("sends a reason still waiting on its pause when the control unmounts", async () => {
    boundary.setSectionExclusion.mockResolvedValue(ok(true));
    const { unmount } = renderControl({ excluded: true });
    await user.type(screen.getByRole("textbox", { name: strings.note }), "Leaving");
    unmount();
    expect(boundary.setSectionExclusion).toHaveBeenCalledWith(null, payload(true, "Leaving"));
  });

  it("retries a crashed save three times, then shows failed with a manual retry", async () => {
    boundary.setSectionExclusion.mockRejectedValue(new Error("network"));
    renderControl();
    await user.click(screen.getByRole("switch"));
    await tick(1000);
    await tick(2000);
    await tick(4000);
    expect(boundary.setSectionExclusion).toHaveBeenCalledTimes(4);
    expect(screen.getByRole("status")).toHaveTextContent(en.assessments.save.failed);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");

    boundary.setSectionExclusion.mockResolvedValue(ok(true));
    await user.click(screen.getByRole("button", { name: en.assessments.save.retry }));
    await tick();
    expect(boundary.setSectionExclusion).toHaveBeenCalledTimes(5);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "saved");
  });

  it("stops after a refusal no retry can fix and names it", async () => {
    boundary.setSectionExclusion.mockResolvedValue({ ok: false, error: "not_allowed" });
    renderControl();
    await user.click(screen.getByRole("switch"));
    await tick(10_000);
    expect(boundary.setSectionExclusion).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).toHaveBeenCalledWith(strings.errors.not_allowed);
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "failed");
  });

  it("a locked answer tells the expert once, refreshes and freezes the switch", async () => {
    boundary.setSectionExclusion.mockResolvedValue({ ok: false, error: "locked" });
    renderControl();
    await user.click(screen.getByRole("switch"));
    await tick();
    expect(boundary.toastError).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).toHaveBeenCalledWith(strings.errors.locked);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("switch")).toBeDisabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch"));
    expect(boundary.setSectionExclusion).toHaveBeenCalledTimes(1);
  });

  it("read only: shows the stored state and the reason as text, with nothing to press", async () => {
    renderControl({ readOnly: true, excluded: true, note: "Contracted out" });
    const toggle = screen.getByRole("switch");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Contracted out")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(toggle);
    expect(boundary.setSectionExclusion).not.toHaveBeenCalled();
  });
});
