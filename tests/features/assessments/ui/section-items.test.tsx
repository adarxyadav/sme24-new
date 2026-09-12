import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaveAnswerResult } from "@/features/assessments/actions";
import {
  itemBlocks,
  SectionItems,
  type SectionItemsProps,
} from "@/features/assessments/ui/section-items";
import {
  ASSESSMENT_ID,
  answer,
  en,
  formatEn,
  GROUPED_ITEMS,
  GROUPS,
  ITEMS,
  item,
  itemId,
  renderWithIntl,
} from "./helpers";

/**
 * The autosave queue of the open section (spec 0019, AC-6, AC-7, AC-8). What these lock in is the
 * contract the expert relies on in a plant with a bad connection: a rating saves at once, a note
 * 800 ms after the last keystroke or on blur, one save in flight per item with the latest value
 * sent after it lands, three automatic retries with backoff before a manual one, the local value
 * never thrown away, a warning before unload while anything is pending, and a locked answer that
 * tells the expert once and freezes the page. The server action, the router and the toaster are
 * the boundaries.
 */
const boundary = vi.hoisted(() => ({
  saveAnswer: vi.fn<(previous: null, input: unknown) => Promise<SaveAnswerResult>>(),
  refresh: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/assessments/actions", () => ({ saveAnswer: boundary.saveAnswer }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: boundary.refresh, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { error: boundary.toastError, success: vi.fn() } }));

const SAVED_AT = "2026-09-12T14:02:00Z";
const shownTime = formatEn.dateTime(new Date(SAVED_AT), { hour: "2-digit", minute: "2-digit" });
const ok = (savedAt = SAVED_AT): SaveAnswerResult => ({ ok: true, data: { savedAt } });
const refused = (error: "locked" | "invalid" | "not_found"): SaveAnswerResult => ({
  ok: false,
  error,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Runs the timers that are due and lets every promise they settled land in React. */
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function renderSection(overrides: Partial<SectionItemsProps> = {}) {
  const props: SectionItemsProps = {
    assessmentId: ASSESSMENT_ID,
    items: ITEMS.filter((candidate) => candidate.sectionKey === "c4"),
    groups: [],
    answers: [],
    locale: "en",
    readOnly: false,
    excluded: false,
    ...overrides,
  };
  return renderWithIntl(<SectionItems {...props} />, "en-CH");
}

const card = (name: string) => screen.getByRole("article", { name });
const radio = (article: HTMLElement, name: string) => within(article).getByRole("radio", { name });
const status = (article: HTMLElement) => within(article).getByRole("status");
const note = (article: HTMLElement) =>
  within(article).getByRole("textbox", { name: en.assessments.item.note });

const payload = (itemId: string, rating: string | null, note = "") => ({
  assessmentId: ASSESSMENT_ID,
  itemId,
  rating,
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
  boundary.saveAnswer.mockReset();
  boundary.refresh.mockReset();
  boundary.toastError.mockReset();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "jest");
});

describe("a rating (AC-6)", () => {
  it("saves at once, shows saving while in flight, then saved with the server's time", async () => {
    const save = deferred<SaveAnswerResult>();
    boundary.saveAnswer.mockReturnValueOnce(save.promise);
    renderSection();
    const article = card("Item 4.1");

    await user.click(radio(article, "Compliant"));
    expect(boundary.saveAnswer).toHaveBeenCalledWith(null, payload(itemId(1), "compliant"));
    expect(radio(article, "Compliant")).toHaveAttribute("aria-checked", "true");
    expect(status(article)).toHaveTextContent(en.assessments.save.saving);

    save.resolve(ok());
    await tick();
    expect(status(article)).toHaveTextContent(`Saved ${shownTime}`);
    expect(status(article)).toHaveAttribute("data-state", "saved");
  });

  it("refreshes the server rendered header once per burst of saves, not once per save", async () => {
    boundary.saveAnswer.mockResolvedValue(ok());
    renderSection();
    await user.click(radio(card("Item 4.1"), "Compliant"));
    await user.click(radio(card("Item 4.2"), "Partially compliant"));
    await tick();
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(2);
    expect(boundary.refresh).not.toHaveBeenCalled();
    await tick(400);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
  });

  it("starts from the stored answers", () => {
    renderSection({ answers: [answer(itemId(1), "partial", "Seen last year")] });
    const article = card("Item 4.1");
    expect(radio(article, "Partially compliant")).toHaveAttribute("aria-checked", "true");
    expect(note(article)).toHaveValue("Seen last year");
    expect(status(article)).toHaveAttribute("data-state", "idle");
  });
});

describe("a note (AC-6)", () => {
  it("saves 800 ms after the last keystroke, with the rating it sits next to", async () => {
    boundary.saveAnswer.mockResolvedValue(ok());
    renderSection({ answers: [answer(itemId(1), "partial")] });
    const article = card("Item 4.1");

    await user.type(note(article), "Seen");
    expect(note(article)).toHaveValue("Seen");
    expect(status(article)).toHaveTextContent(en.assessments.save.pending);
    expect(boundary.saveAnswer).not.toHaveBeenCalled();

    await tick(799);
    expect(boundary.saveAnswer).not.toHaveBeenCalled();
    await tick(1);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
    expect(boundary.saveAnswer).toHaveBeenCalledWith(null, payload(itemId(1), "partial", "Seen"));
    await tick();
    expect(status(article)).toHaveAttribute("data-state", "saved");
  });

  it("saves on blur without waiting for the pause", async () => {
    boundary.saveAnswer.mockResolvedValue(ok());
    renderSection();
    const article = card("Item 4.1");
    await user.type(note(article), "Seen");
    await user.tab();
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
    expect(boundary.saveAnswer).toHaveBeenCalledWith(null, payload(itemId(1), null, "Seen"));
    await tick(800);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
  });

  it("sends a note still waiting on its pause when the section unmounts", async () => {
    boundary.saveAnswer.mockResolvedValue(ok());
    const { unmount } = renderSection();
    await user.type(note(card("Item 4.1")), "Leaving");
    expect(boundary.saveAnswer).not.toHaveBeenCalled();
    unmount();
    expect(boundary.saveAnswer).toHaveBeenCalledWith(null, payload(itemId(1), null, "Leaving"));
  });
});

describe("one save in flight per item (AC-6)", () => {
  it("sends a change made while a save is in flight again afterwards with the latest value", async () => {
    const first = deferred<SaveAnswerResult>();
    boundary.saveAnswer.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok());
    renderSection();
    const article = card("Item 4.1");

    await user.click(radio(article, "Compliant"));
    await user.click(radio(article, "Non compliant"));
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
    expect(status(article)).toHaveTextContent(en.assessments.save.pending);

    first.resolve(ok());
    await tick();
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(2);
    expect(boundary.saveAnswer).toHaveBeenLastCalledWith(null, payload(itemId(1), "non_compliant"));
    await tick();
    expect(status(article)).toHaveAttribute("data-state", "saved");
    expect(radio(article, "Non compliant")).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the items independent: a save on one never blocks the other", async () => {
    const slow = deferred<SaveAnswerResult>();
    boundary.saveAnswer.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(ok());
    renderSection();
    await user.click(radio(card("Item 4.1"), "Compliant"));
    await user.click(radio(card("Item 4.2"), "Compliant"));
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(2);
    await tick();
    expect(status(card("Item 4.2"))).toHaveAttribute("data-state", "saved");
    expect(status(card("Item 4.1"))).toHaveAttribute("data-state", "saving");
    slow.resolve(ok());
  });
});

describe("failures (AC-6)", () => {
  it("retries a crashed save three times with backoff, then shows failed with a manual retry and keeps the value", async () => {
    boundary.saveAnswer.mockRejectedValue(new Error("network"));
    renderSection();
    const article = card("Item 4.1");

    await user.click(radio(article, "Compliant"));
    await tick();
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
    expect(status(article)).toHaveTextContent(en.assessments.save.saving);

    await tick(999);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(2);
    await tick(2000);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(3);
    await tick(4000);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(4);

    expect(status(article)).toHaveTextContent(en.assessments.save.failed);
    expect(within(article).getByRole("button", { name: en.assessments.save.retry })).toBeVisible();
    expect(radio(article, "Compliant")).toHaveAttribute("aria-checked", "true");
    expect(boundary.toastError).not.toHaveBeenCalled();

    await tick(60_000);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(4);

    boundary.saveAnswer.mockResolvedValue(ok());
    await user.click(within(article).getByRole("button", { name: en.assessments.save.retry }));
    await tick();
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(5);
    expect(boundary.saveAnswer).toHaveBeenLastCalledWith(null, payload(itemId(1), "compliant"));
    expect(status(article)).toHaveAttribute("data-state", "saved");
  });

  it("treats a refusal no retry can fix as final: one call, a toast, the value kept", async () => {
    boundary.saveAnswer.mockResolvedValue(refused("invalid"));
    renderSection();
    const article = card("Item 4.1");
    await user.click(radio(article, "Compliant"));
    await tick(10_000);
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).toHaveBeenCalledWith(en.assessments.errors.invalid);
    expect(status(article)).toHaveAttribute("data-state", "failed");
    expect(radio(article, "Compliant")).toHaveAttribute("aria-checked", "true");
  });

  it("tells the expert once and freezes the page when the save is refused as locked", async () => {
    boundary.saveAnswer.mockResolvedValue(refused("locked"));
    renderSection({ answers: [answer(itemId(2), "compliant", "Kept")] });
    const article = card("Item 4.1");
    await user.click(radio(article, "Compliant"));
    await tick();

    expect(boundary.toastError).toHaveBeenCalledTimes(1);
    expect(boundary.toastError).toHaveBeenCalledWith(en.assessments.errors.locked);
    expect(boundary.refresh).toHaveBeenCalledTimes(1);
    for (const control of screen.getAllByRole("radio")) expect(control).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Kept")).toBeInTheDocument();

    await user.click(radio(card("Item 4.2"), "Non compliant"));
    expect(boundary.saveAnswer).toHaveBeenCalledTimes(1);
  });

  it("warns before unload while a save is pending and stops once it landed", async () => {
    const save = deferred<SaveAnswerResult>();
    boundary.saveAnswer.mockReturnValueOnce(save.promise);
    renderSection();
    const leave = () => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(leave()).toBe(false);
    await user.click(radio(card("Item 4.1"), "Compliant"));
    expect(leave()).toBe(true);
    save.resolve(ok());
    await tick();
    expect(leave()).toBe(false);
  });
});

describe("a frozen section (AC-8, AC-9)", () => {
  it("never saves while the assessment is submitted: every control disabled, notes as text", async () => {
    renderSection({ readOnly: true, answers: [answer(itemId(1), "partial", "Old note")] });
    for (const control of screen.getAllByRole("radio")) expect(control).toBeDisabled();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Old note")).toBeInTheDocument();
    await user.click(radio(card("Item 4.1"), "Compliant"));
    expect(boundary.saveAnswer).not.toHaveBeenCalled();
  });

  it("greys a section marked not applicable and disables its items", async () => {
    const { container } = renderSection({ excluded: true });
    const root = container.querySelector("[data-section-items]");
    expect(root).toHaveAttribute("data-excluded", "true");
    expect(root).toHaveAttribute("aria-disabled", "true");
    for (const control of screen.getAllByRole("radio")) expect(control).toBeDisabled();
    await user.click(radio(card("Item 4.1"), "Compliant"));
    expect(boundary.saveAnswer).not.toHaveBeenCalled();
  });
});

describe("the annex suggestion (AC-7)", () => {
  it("reads the local ratings of the checks before they land and applies the clause rating through the same save", async () => {
    boundary.saveAnswer.mockResolvedValue(ok());
    renderSection({ items: ITEMS.filter((candidate) => candidate.sectionKey === "c7") });
    const clause = card("Item 7.2");
    expect(within(clause).queryByText(/Suggested for the clause/)).not.toBeInTheDocument();

    const a1 = within(clause).getByRole("radiogroup", { name: "Item A.1" });
    const a2 = within(clause).getByRole("radiogroup", { name: "Item A.2" });
    await user.click(within(a1).getByRole("radio", { name: "Compliant" }));
    expect(
      within(clause).getByText("Suggested for the clause: Compliant (1 of 2 checks rated)"),
    ).toBeInTheDocument();
    await user.click(within(a2).getByRole("radio", { name: "Non compliant" }));
    expect(
      within(clause).getByText(
        "Suggested for the clause: Partially compliant (2 of 2 checks rated)",
      ),
    ).toBeInTheDocument();

    await user.click(
      within(clause).getByRole("button", { name: en.assessments.item.applySuggestion }),
    );
    expect(boundary.saveAnswer).toHaveBeenLastCalledWith(null, payload(itemId(3), "partial"));
    await tick();
    expect(
      within(clause).queryByRole("button", { name: en.assessments.item.applySuggestion }),
    ).not.toBeInTheDocument();
  });
});

describe("the technical standards (AC-8)", () => {
  it("renders the items under their group headings and drops an empty group", () => {
    renderSection({ items: GROUPED_ITEMS, groups: GROUPS });
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["1Fire watch", "2Permits"]);
    expect(screen.queryByText("Equipment")).not.toBeInTheDocument();
    const fireWatch = screen.getByRole("region", { name: "1Fire watch" });
    expect(within(fireWatch).getAllByRole("heading", { level: 4 })).toHaveLength(2);
    expect(within(fireWatch).getByRole("article", { name: "Item 1.2" })).toBeInTheDocument();
  });
});

describe("itemBlocks", () => {
  const groups = GROUPS;
  it("puts the ungrouped items first, then one block per outline group in outline order", () => {
    const loose = item(9, "0.1", "hot_work", { id: "compliance@1/9" });
    const blocks = itemBlocks([...GROUPED_ITEMS, loose], groups);
    expect(
      blocks.map((block) => [block.group?.key ?? null, block.items.map((i) => i.label)]),
    ).toEqual([
      [null, ["0.1"]],
      ["hot_work.1", ["1.1", "1.2"]],
      ["hot_work.2", ["2.1"]],
    ]);
  });

  it("counts an item naming a group the outline does not carry as ungrouped rather than dropping it", () => {
    const stray = item(9, "9.1", "hot_work", { id: "compliance@1/9", groupKey: "hot_work.9" });
    const blocks = itemBlocks([stray, ...GROUPED_ITEMS], groups);
    expect(blocks[0]).toEqual({ group: null, items: [stray] });
    expect(blocks).toHaveLength(3);
  });

  it("leaves sub items to their clause and answers one ungrouped block for ISO 45001", () => {
    const blocks = itemBlocks(ITEMS, []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.items.map((i) => i.label)).toEqual(["4.1", "4.2", "7.2"]);
  });

  it("answers nothing for no items", () => {
    expect(itemBlocks([], groups)).toEqual([]);
  });
});
