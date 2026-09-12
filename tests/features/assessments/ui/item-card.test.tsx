import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  type ItemAnswerState,
  ItemCard,
  type ItemCardProps,
  type ItemHandlers,
} from "@/features/assessments/ui/item-card";
import { de, en, ITEMS, item, itemId, renderWithIntl } from "./helpers";

/**
 * One item of the open section (spec 0019, AC-6, AC-7, AC-11): the card is named by its title,
 * the requirement sits behind a disclosure, the annex checks nest inside a clause with their own
 * controls while a context line stays text, the suggestion offers Apply only while it differs from
 * the clause rating, the note is described by the privacy hint, and a read only card shows the
 * note as text with nothing to press.
 */
const strings = en.assessments.item;
const CLAUSE = ITEMS[2] as NonNullable<(typeof ITEMS)[2]>;
const SUB_ITEMS = ITEMS.filter((candidate) => candidate.parentId === CLAUSE.id);
const FIRST = ITEMS[0] as NonNullable<(typeof ITEMS)[0]>;

function handlers(): ItemHandlers {
  return {
    onRatingChange: vi.fn(),
    onNoteChange: vi.fn(),
    onNoteBlur: vi.fn(),
    onRetry: vi.fn(),
  };
}

function answers(entries: Record<string, Partial<ItemAnswerState>>) {
  return new Map(
    Object.entries(entries).map(([id, answer]) => [
      id,
      { rating: null, note: "", save: "idle" as const, savedAt: null, ...answer },
    ]),
  );
}

function renderCard(overrides: Partial<ItemCardProps> = {}, locale: "en-CH" | "de-CH" = "en-CH") {
  const h = handlers();
  const props: ItemCardProps = {
    item: FIRST,
    subItems: [],
    answers: new Map(),
    suggestion: null,
    locale: locale === "de-CH" ? "de" : "en",
    readOnly: false,
    handlers: h,
    ...overrides,
  };
  const view = renderWithIntl(<ItemCard {...props} />, locale);
  return { ...view, handlers: h };
}

describe("ItemCard (AC-6)", () => {
  it("is an article named by the item's title, with its label, the question and a labelled note", () => {
    renderCard();
    const article = screen.getByRole("article", { name: "Item 4.1" });
    expect(within(article).getByText("4.1")).toHaveAttribute("translate", "no");
    expect(within(article).getByText(strings.question)).toBeInTheDocument();
    expect(within(article).getByText("Question 4.1")).toBeInTheDocument();
    expect(within(article).getByRole("radiogroup", { name: "Item 4.1" })).toBeInTheDocument();
    expect(within(article).getByRole("textbox", { name: strings.note })).toBeInTheDocument();
    expect(within(article).getByRole("status")).toBeInTheDocument();
  });

  it("keeps the requirement behind a disclosure that opens on its button", async () => {
    const user = userEvent.setup();
    renderCard();
    const trigger = screen.getByRole("button", { name: strings.showRequirement });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Records kept")).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByRole("button", { name: strings.hideRequirement })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getByText("Records kept")).toBeVisible();
    expect(screen.getByText("Training planned")).toBeVisible();
  });

  it("shows no disclosure for an item without a requirement", () => {
    renderCard({ item: item(9, "9.9", "c9") });
    expect(screen.queryByRole("button", { name: strings.showRequirement })).not.toBeInTheDocument();
  });

  it("describes the note by the privacy hint and caps it at the column's length", () => {
    renderCard();
    const note = screen.getByRole("textbox", { name: strings.note });
    expect(note).toHaveAccessibleDescription(strings.noteHint);
    expect(note).toHaveAttribute("maxlength", "4000");
  });

  it("hands a rating click, a keystroke in the note and the blur to the handlers", async () => {
    const user = userEvent.setup();
    const { handlers: h } = renderCard();
    await user.click(screen.getByRole("radio", { name: "Partially compliant" }));
    expect(h.onRatingChange).toHaveBeenCalledWith(FIRST.id, "partial");
    const note = screen.getByRole("textbox", { name: strings.note });
    await user.type(note, "x");
    expect(h.onNoteChange).toHaveBeenCalledWith(FIRST.id, "x");
    await user.tab();
    expect(h.onNoteBlur).toHaveBeenCalledWith(FIRST.id);
  });

  it("renders the stored answer: the rating checked, the note filled, the indicator in its state", () => {
    renderCard({
      answers: answers({
        [FIRST.id]: {
          rating: "non_compliant",
          note: "Seen it",
          save: "saved",
          savedAt: "2026-09-12T14:02:00Z",
        },
      }),
    });
    expect(screen.getByRole("radio", { name: "Non compliant" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("textbox", { name: strings.note })).toHaveValue("Seen it");
    expect(screen.getByRole("status")).toHaveAttribute("data-state", "saved");
  });

  it("wires the retry of the indicator to the item", async () => {
    const user = userEvent.setup();
    const { handlers: h } = renderCard({ answers: answers({ [FIRST.id]: { save: "failed" } }) });
    await user.click(screen.getByRole("button", { name: en.assessments.save.retry }));
    expect(h.onRetry).toHaveBeenCalledWith(FIRST.id);
  });

  it("read only: disables the rating, shows the note as text and drops the field and the indicator", () => {
    renderCard({
      readOnly: true,
      answers: answers({ [FIRST.id]: { rating: "compliant", note: "Records on file" } }),
    });
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Compliant" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Records on file")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("uses a level four heading under a group heading of the technical standards", () => {
    renderCard({ headingLevel: "h4" });
    expect(screen.getByRole("heading", { level: 4, name: "Item 4.1" })).toBeInTheDocument();
  });
});

describe("the German page (AC-11)", () => {
  it("shows the German text and a machine translated note while the German is unreviewed", () => {
    const unreviewed = ITEMS[1] as NonNullable<(typeof ITEMS)[1]>;
    renderCard({ item: unreviewed }, "de-CH");
    expect(screen.getByRole("article", { name: "Item 4.2 (de)" })).toBeInTheDocument();
    expect(screen.getByText("Question 4.2 (de)")).toBeInTheDocument();
    expect(screen.getByText(de.assessments.item.machineTranslated)).toBeInTheDocument();
  });

  it("shows no such note once the German is reviewed, and never on the English page", () => {
    const { unmount } = renderCard({ item: FIRST }, "de-CH");
    expect(screen.queryByText(de.assessments.item.machineTranslated)).not.toBeInTheDocument();
    unmount();
    const unreviewed = ITEMS[1] as NonNullable<(typeof ITEMS)[1]>;
    renderCard({ item: unreviewed }, "en-CH");
    expect(screen.queryByText(strings.machineTranslated)).not.toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Item 4.2" })).toBeInTheDocument();
  });
});

describe("an annex clause (AC-7)", () => {
  it("nests the checks in a named region: the rateable ones with their own control and note, the context line as text", () => {
    renderCard({ item: CLAUSE, subItems: SUB_ITEMS });
    const region = screen.getByRole("region", { name: strings.subItems });
    expect(within(region).getByText(strings.subItemsLead)).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
    expect(within(region).getByRole("radiogroup", { name: "Item A.1" })).toBeInTheDocument();
    expect(within(region).getByRole("radiogroup", { name: "Item A.2" })).toBeInTheDocument();
    expect(within(region).queryByRole("radiogroup", { name: "Item A.3" })).not.toBeInTheDocument();
    expect(within(region).getByText("Item A.3")).toBeInTheDocument();
    expect(within(region).getAllByRole("textbox", { name: strings.note })).toHaveLength(2);
    // The clause keeps its own control outside the region.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(3);
  });

  it("routes a sub item's rating to that sub item, not to the clause", async () => {
    const user = userEvent.setup();
    const { handlers: h } = renderCard({ item: CLAUSE, subItems: SUB_ITEMS });
    const a2 = screen.getByRole("radiogroup", { name: "Item A.2" });
    await user.click(within(a2).getByRole("radio", { name: "Compliant" }));
    expect(h.onRatingChange).toHaveBeenCalledWith(itemId(5), "compliant");
    expect(h.onRatingChange).not.toHaveBeenCalledWith(CLAUSE.id, "compliant");
  });

  it("shows the suggestion with its counts and an Apply button that writes the clause rating", async () => {
    const user = userEvent.setup();
    const { handlers: h } = renderCard({
      item: CLAUSE,
      subItems: SUB_ITEMS,
      suggestion: { rating: "partial", rated: 1, total: 2 },
    });
    expect(
      screen.getByText("Suggested for the clause: Partially compliant (1 of 2 checks rated)"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: strings.applySuggestion }));
    expect(h.onRatingChange).toHaveBeenCalledWith(CLAUSE.id, "partial");
  });

  it("hides Apply once the clause already carries the suggested rating, and on a read only card", () => {
    const { unmount } = renderCard({
      item: CLAUSE,
      subItems: SUB_ITEMS,
      suggestion: { rating: "compliant", rated: 2, total: 2 },
      answers: answers({ [CLAUSE.id]: { rating: "compliant" } }),
    });
    expect(screen.getByText(/Suggested for the clause/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: strings.applySuggestion })).not.toBeInTheDocument();
    unmount();
    renderCard({
      item: CLAUSE,
      subItems: SUB_ITEMS,
      suggestion: { rating: "compliant", rated: 2, total: 2 },
      readOnly: true,
    });
    expect(screen.queryByRole("button", { name: strings.applySuggestion })).not.toBeInTheDocument();
  });

  it("shows no suggestion line for a clause without one", () => {
    renderCard({ item: CLAUSE, subItems: SUB_ITEMS, suggestion: null });
    expect(screen.queryByText(/Suggested for the clause/)).not.toBeInTheDocument();
  });
});
