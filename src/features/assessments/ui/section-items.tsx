"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type SaveAnswerResult, saveAnswer } from "@/features/assessments/actions";
import type { RatingCode } from "@/features/assessments/catalogue";
import type { ContentGroup } from "@/features/assessments/content-schema";
import {
  type AssessmentAnswer,
  type AssessmentItem,
  suggestedRating,
} from "@/features/assessments/model";
import type { LocaleCode } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { type ItemAnswerState, ItemCard, type ItemHandlers } from "./item-card";
import type { SaveState } from "./save-indicator";

export type SectionItemsProps = {
  readonly assessmentId: string;
  /** Every item of the open section, sub items included, in position order. */
  readonly items: readonly AssessmentItem[];
  /** The groups of the open section from the version's outline; empty for ISO 45001. */
  readonly groups: readonly ContentGroup[];
  /** The stored answers of those items, the starting point of the local state. */
  readonly answers: readonly AssessmentAnswer[];
  readonly locale: LocaleCode;
  /** True once the assessment is submitted: every control disabled, nothing saves. */
  readonly readOnly: boolean;
  /** True while the section is marked not applicable (AC-8): greyed, every control disabled. */
  readonly excluded: boolean;
};

/** One run of top level items under a group heading, or the ungrouped ones with none. */
export type ItemBlock = {
  readonly group: ContentGroup | null;
  readonly items: readonly AssessmentItem[];
};

/**
 * The top level items of a section in blocks (AC-8): the ungrouped ones first, then one block
 * per group of the outline in outline order, empty groups dropped. An item naming a group the
 * outline does not carry counts as ungrouped rather than vanishing. Pure.
 */
export function itemBlocks(
  items: readonly AssessmentItem[],
  groups: readonly ContentGroup[],
): readonly ItemBlock[] {
  const topLevel = items.filter((item) => item.parentId === null);
  const known = new Set(groups.map((group) => group.key));
  const ungrouped = topLevel.filter((item) => item.groupKey === null || !known.has(item.groupKey));
  const grouped = groups.flatMap((group): ItemBlock[] => {
    const own = topLevel.filter((item) => item.groupKey === group.key);
    return own.length === 0 ? [] : [{ group, items: own }];
  });
  return ungrouped.length === 0 ? grouped : [{ group: null, items: ungrouped }, ...grouped];
}

/** A note saves this long after the last keystroke (spec 0019, AC-6). */
const NOTE_DEBOUNCE_MS = 800;
/** Automatic retries on a network or unexpected failure, with 1 s, 2 s and 4 s between them. */
const MAX_RETRIES = 3;
/** Successful saves within this window collapse into one server refresh of the header and nav. */
const REFRESH_DEBOUNCE_MS = 400;

type Queue = {
  timer: number | null;
  inFlight: boolean;
  /** A change arrived while a save was in flight; send again with the latest value once it lands. */
  dirty: boolean;
  attempt: number;
};

type Value = { readonly rating: RatingCode | null; readonly note: string };

/** The failures that no retry can fix: the page tells the expert and keeps the local value. */
const TERMINAL: ReadonlySet<string> = new Set(["not_found", "invalid", "validation", "forbidden"]);

/**
 * The items of the open section with the local answer state and the autosave queue (spec 0019,
 * AC-6, AC-7). One save is in flight per item at a time; a change made meanwhile is sent after it
 * lands with the latest value, so the last thing the expert did always wins. A rating saves at
 * once, a note 800 ms after the last keystroke or on blur. A network or unexpected failure retries
 * three times with backoff, then shows failed with a manual retry, and the local value is never
 * thrown away. The browser warns before unload while anything is pending or failed. A save
 * refused with `locked` tells the expert once and switches the page to read only through a
 * server refresh. Every successful save also refreshes the server rendered header and navigator,
 * coalesced, so the progress and the running score keep up. The technical standards render their
 * items under group headings from the outline (AC-8), and a section marked not applicable is
 * greyed with every control disabled. Browser.
 */
export function SectionItems({
  assessmentId,
  items,
  groups,
  answers,
  locale,
  readOnly,
  excluded,
}: SectionItemsProps) {
  const t = useTranslations("assessments.errors");
  const router = useRouter();
  const [locked, setLocked] = useState(false);
  const [state, setState] = useState<ReadonlyMap<string, ItemAnswerState>>(() =>
    initialState(answers),
  );
  const values = useRef<Map<string, Value>>(new Map(initialValues(answers)));
  const queues = useRef<Map<string, Queue>>(new Map());
  const refreshTimer = useRef<number | null>(null);
  const frozen = readOnly || locked || excluded;

  const patch = useCallback((itemId: string, change: Partial<ItemAnswerState>) => {
    setState((previous) => {
      const next = new Map(previous);
      const current = previous.get(itemId) ?? {
        rating: null,
        note: "",
        save: "idle",
        savedAt: null,
      };
      next.set(itemId, { ...current, ...change });
      return next;
    });
  }, []);

  const queueOf = useCallback((itemId: string): Queue => {
    const existing = queues.current.get(itemId);
    if (existing) return existing;
    const created: Queue = { timer: null, inFlight: false, dirty: false, attempt: 0 };
    queues.current.set(itemId, created);
    return created;
  }, []);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    refreshTimer.current = window.setTimeout(() => {
      refreshTimer.current = null;
      router.refresh();
    }, REFRESH_DEBOUNCE_MS);
  }, [router]);

  const lock = useCallback(() => {
    setLocked((already) => {
      if (!already) {
        toast.error(t("locked"));
        router.refresh();
      }
      return true;
    });
  }, [router, t]);

  // The latest send is reached through a ref, so a timer set by an older render never calls a
  // stale closure.
  const sendRef = useRef<(itemId: string) => void>(() => {});
  const send = useCallback(
    async (itemId: string) => {
      const queue = queueOf(itemId);
      if (queue.timer !== null) {
        window.clearTimeout(queue.timer);
        queue.timer = null;
      }
      if (queue.inFlight) {
        queue.dirty = true;
        return;
      }
      queue.inFlight = true;
      queue.dirty = false;
      const value = values.current.get(itemId) ?? { rating: null, note: "" };
      patch(itemId, { save: "saving" });

      let result: SaveAnswerResult | null = null;
      try {
        result = await saveAnswer(null, {
          assessmentId,
          itemId,
          rating: value.rating,
          note: value.note,
        });
      } catch {
        result = null;
      }
      queue.inFlight = false;

      if (result?.ok) {
        queue.attempt = 0;
        patch(itemId, { save: queue.dirty ? "pending" : "saved", savedAt: result.data.savedAt });
        scheduleRefresh();
        if (queue.dirty) sendRef.current(itemId);
        return;
      }
      if (result && result.error === "locked") {
        patch(itemId, { save: "failed" });
        lock();
        return;
      }
      if (result && TERMINAL.has(result.error)) {
        patch(itemId, { save: "failed" });
        toast.error(t(result.error as "not_found"));
        return;
      }
      if (queue.attempt < MAX_RETRIES) {
        queue.attempt += 1;
        queue.timer = window.setTimeout(
          () => sendRef.current(itemId),
          1000 * 2 ** (queue.attempt - 1),
        );
        return;
      }
      queue.attempt = 0;
      patch(itemId, { save: "failed" });
    },
    [assessmentId, lock, patch, queueOf, scheduleRefresh, t],
  );
  sendRef.current = send;

  const change = useCallback(
    (itemId: string, next: Partial<Value>, delay: number) => {
      const current = values.current.get(itemId) ?? { rating: null, note: "" };
      values.current.set(itemId, { ...current, ...next });
      patch(itemId, { ...next, save: "pending" });
      const queue = queueOf(itemId);
      if (queue.timer !== null) window.clearTimeout(queue.timer);
      queue.timer = null;
      if (queue.inFlight) {
        queue.dirty = true;
        return;
      }
      if (delay === 0) {
        sendRef.current(itemId);
        return;
      }
      queue.timer = window.setTimeout(() => sendRef.current(itemId), delay);
    },
    [patch, queueOf],
  );

  const handlers = useMemo<ItemHandlers>(
    () => ({
      onRatingChange: (itemId, rating) => {
        if (frozen) return;
        change(itemId, { rating }, 0);
      },
      onNoteChange: (itemId, note) => {
        if (frozen) return;
        change(itemId, { note }, NOTE_DEBOUNCE_MS);
      },
      onNoteBlur: (itemId) => {
        const queue = queues.current.get(itemId);
        if (queue?.timer !== null && queue?.timer !== undefined) sendRef.current(itemId);
      },
      onRetry: (itemId) => {
        if (frozen) return;
        patch(itemId, { save: "pending" });
        sendRef.current(itemId);
      },
    }),
    [change, frozen, patch],
  );

  // Warn before the tab closes while a save is waiting, in flight or failed: the local value is
  // the only copy until it lands.
  const busy = [...state.values()].some((answer) => isBusy(answer.save));
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  // Leaving the section (the navigator is a link, so this component unmounts) sends every note
  // still waiting on its debounce rather than dropping it.
  useEffect(() => {
    const pending = queues.current;
    return () => {
      for (const [itemId, queue] of pending) {
        if (queue.timer !== null) {
          window.clearTimeout(queue.timer);
          queue.timer = null;
          sendRef.current(itemId);
        }
      }
      if (refreshTimer.current !== null) window.clearTimeout(refreshTimer.current);
    };
  }, []);

  const currentAnswers = useMemo<readonly AssessmentAnswer[]>(
    () =>
      [...state].map(([itemId, answer]) => ({
        itemId,
        sectionKey: null,
        rating: answer.rating,
        note: answer.note === "" ? null : answer.note,
      })),
    [state],
  );
  const blocks = itemBlocks(items, groups);

  const cards = (blockItems: readonly AssessmentItem[], headingLevel: "h3" | "h4") =>
    blockItems.map((item) => {
      const subItems = items.filter((candidate) => candidate.parentId === item.id);
      return (
        <li key={item.id}>
          <ItemCard
            item={item}
            subItems={subItems}
            answers={state}
            suggestion={
              subItems.length > 0 ? suggestedRating(item.id, items, currentAnswers) : null
            }
            locale={locale}
            readOnly={frozen}
            headingLevel={headingLevel}
            handlers={handlers}
          />
        </li>
      );
    });

  return (
    <div
      className={cn("flex flex-col gap-8", excluded && "opacity-60")}
      data-section-items
      data-excluded={excluded ? "true" : undefined}
      aria-disabled={excluded || undefined}
    >
      {blocks.map((block) =>
        block.group ? (
          <section
            key={block.group.key}
            aria-labelledby={`group-${slug(block.group.key)}`}
            data-group={block.group.key}
            className="flex flex-col gap-4"
          >
            <h3
              id={`group-${slug(block.group.key)}`}
              className="flex items-baseline gap-3 font-medium text-base leading-snug"
            >
              <span className="font-mono text-muted-foreground text-xs tabular-nums" translate="no">
                {block.group.label}
              </span>
              <span>{block.group.title[locale]}</span>
            </h3>
            <ol className="flex flex-col gap-6">{cards(block.items, "h4")}</ol>
          </section>
        ) : (
          <ol key="ungrouped" className="flex flex-col gap-6">
            {cards(block.items, "h3")}
          </ol>
        ),
      )}
    </div>
  );
}

/** A group key as an id fragment: `electrical_safety.2` becomes `electrical_safety-2`. */
function slug(key: string): string {
  return key.replace(/[^a-z0-9_]+/gi, "-");
}

function isBusy(save: SaveState): boolean {
  return save === "pending" || save === "saving" || save === "failed";
}

function initialState(answers: readonly AssessmentAnswer[]): ReadonlyMap<string, ItemAnswerState> {
  return new Map(
    answers.flatMap((answer) =>
      answer.itemId === null
        ? []
        : [
            [
              answer.itemId,
              { rating: answer.rating, note: answer.note ?? "", save: "idle", savedAt: null },
            ] as const,
          ],
    ),
  );
}

function initialValues(
  answers: readonly AssessmentAnswer[],
): ReadonlyArray<readonly [string, Value]> {
  return answers.flatMap((answer) =>
    answer.itemId === null
      ? []
      : [[answer.itemId, { rating: answer.rating, note: answer.note ?? "" }] as const],
  );
}
