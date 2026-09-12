"use client";

import { ChevronDownIcon, LanguagesIcon, SparklesIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import type { RatingCode } from "@/features/assessments/catalogue";
import type { AssessmentItem, Suggestion } from "@/features/assessments/model";
import type { LocaleCode } from "@/i18n/routing";
import { cn } from "@/lib/utils";
import { RatingControl } from "./rating-control";
import { RichText } from "./rich-text";
import { SaveIndicator, type SaveState } from "./save-indicator";

/** The local answer of one item: what the expert sees, whether or not it has landed yet. */
export type ItemAnswerState = {
  readonly rating: RatingCode | null;
  readonly note: string;
  readonly save: SaveState;
  readonly savedAt: string | null;
};

export type ItemHandlers = {
  readonly onRatingChange: (itemId: string, rating: RatingCode) => void;
  readonly onNoteChange: (itemId: string, note: string) => void;
  readonly onNoteBlur: (itemId: string) => void;
  readonly onRetry: (itemId: string) => void;
};

export type ItemCardProps = {
  readonly item: AssessmentItem;
  /** The annex lines under a clause, in position order; empty for every other item. */
  readonly subItems: readonly AssessmentItem[];
  readonly answers: ReadonlyMap<string, ItemAnswerState>;
  readonly suggestion: Suggestion | null;
  readonly locale: LocaleCode;
  readonly readOnly: boolean;
  /** `h4` under a group heading of the technical standards, `h3` (the default) otherwise. */
  readonly headingLevel?: "h3" | "h4";
  readonly handlers: ItemHandlers;
};

const EMPTY: ItemAnswerState = { rating: null, note: "", save: "idle", savedAt: null };

/**
 * One item of the open section (spec 0019, AC-6, AC-7, AC-11): label and title, the requirement
 * behind a disclosure, the question, the rating control, the note with its privacy hint and the
 * save indicator. An annex clause also renders its sub items nested inside, each rateable line
 * with its own control and note and each context line as plain text, plus the suggestion line
 * with an Apply button. German text the build script drafted carries a small note until a
 * person reviews it. Browser.
 */
export function ItemCard({
  item,
  subItems,
  answers,
  suggestion,
  locale,
  readOnly,
  headingLevel: Heading = "h3",
  handlers,
}: ItemCardProps) {
  const t = useTranslations("assessments");
  const answer = answers.get(item.id) ?? EMPTY;
  const titleId = `item-${slug(item.id)}-title`;
  const ratingLabels = {
    compliant: t("ratings.compliant"),
    partial: t("ratings.partial"),
    non_compliant: t("ratings.non_compliant"),
  } as const;

  return (
    <article
      aria-labelledby={titleId}
      data-item={item.id}
      className="flex flex-col gap-5 rounded-xl border bg-card p-5 text-card-foreground shadow-xs"
    >
      <header className="flex flex-col gap-1.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-muted-foreground text-xs tabular-nums" translate="no">
            {item.label}
          </span>
          <Heading id={titleId} className="font-medium text-base leading-snug">
            {item.title[locale]}
          </Heading>
        </div>
        {locale === "de" && !item.deReviewed ? <MachineTranslatedNote /> : null}
      </header>

      {item.requirement ? <Requirement text={item.requirement[locale]} /> : null}

      <div className="flex flex-col gap-1.5">
        <p className="text-muted-foreground text-xs">{t("item.question")}</p>
        <RichText text={item.question[locale]} className="max-w-prose text-sm" />
      </div>

      {subItems.length > 0 ? (
        <SubItems
          subItems={subItems}
          answers={answers}
          locale={locale}
          readOnly={readOnly}
          handlers={handlers}
          ratingLabels={ratingLabels}
        />
      ) : null}

      {suggestion ? (
        <div
          data-suggestion={suggestion.rating}
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm"
        >
          <SparklesIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span>
            {t("item.suggestion", {
              rating: ratingLabels[suggestion.rating],
              rated: suggestion.rated,
              total: suggestion.total,
            })}
          </span>
          {!readOnly && answer.rating !== suggestion.rating ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => handlers.onRatingChange(item.id, suggestion.rating)}
            >
              {t("item.applySuggestion")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <AnswerFields
        itemId={item.id}
        titleId={titleId}
        answer={answer}
        readOnly={readOnly}
        handlers={handlers}
        ratingLabels={ratingLabels}
      />
    </article>
  );
}

function slug(id: string): string {
  return id.replaceAll(/[^a-z0-9]+/gi, "-");
}

function MachineTranslatedNote() {
  const t = useTranslations("assessments.item");
  return (
    <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
      <LanguagesIcon aria-hidden="true" className="size-3.5 shrink-0" />
      {t("machineTranslated")}
    </p>
  );
}

function Requirement({ text }: { readonly text: string }) {
  const t = useTranslations("assessments.item");
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col gap-2">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-fit px-1.5 -ml-1.5">
          <ChevronDownIcon
            data-icon="inline-start"
            aria-hidden="true"
            className={cn("transition-transform", open && "rotate-180")}
          />
          {open ? t("hideRequirement") : t("showRequirement")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <RichText
          text={text}
          className="max-w-prose border-l-2 border-border pl-4 text-muted-foreground text-sm"
        />
      </CollapsibleContent>
    </Collapsible>
  );
}

type AnswerFieldsProps = {
  readonly itemId: string;
  readonly titleId: string;
  readonly answer: ItemAnswerState;
  readonly readOnly: boolean;
  readonly handlers: ItemHandlers;
  readonly ratingLabels: { readonly [R in RatingCode]: string };
  readonly compact?: boolean;
};

/** The rating, the note and the save indicator: shared by a clause and by a rateable sub item. */
function AnswerFields({
  itemId,
  titleId,
  answer,
  readOnly,
  handlers,
  ratingLabels,
  compact = false,
}: AnswerFieldsProps) {
  const t = useTranslations("assessments.item");
  const noteId = useId();
  const hintId = `${noteId}-hint`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RatingControl
          labelledBy={titleId}
          value={answer.rating}
          onValueChange={(rating) => handlers.onRatingChange(itemId, rating)}
          labels={ratingLabels}
          disabled={readOnly}
        />
        {readOnly ? null : (
          <SaveIndicator
            state={answer.save}
            savedAt={answer.savedAt}
            onRetry={() => handlers.onRetry(itemId)}
          />
        )}
      </div>
      {readOnly ? (
        answer.note ? (
          <p className="whitespace-pre-wrap text-sm">{answer.note}</p>
        ) : null
      ) : (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="font-medium text-sm">
            {t("note")}
          </label>
          <Textarea
            id={noteId}
            value={answer.note}
            onChange={(event) => handlers.onNoteChange(itemId, event.target.value)}
            onBlur={() => handlers.onNoteBlur(itemId)}
            aria-describedby={hintId}
            maxLength={4000}
            rows={compact ? 2 : 3}
            className={compact ? "min-h-12" : undefined}
          />
          <p id={hintId} className="text-muted-foreground text-xs">
            {t("noteHint")}
          </p>
        </div>
      )}
    </div>
  );
}

type SubItemsProps = {
  readonly subItems: readonly AssessmentItem[];
  readonly answers: ReadonlyMap<string, ItemAnswerState>;
  readonly locale: LocaleCode;
  readonly readOnly: boolean;
  readonly handlers: ItemHandlers;
  readonly ratingLabels: { readonly [R in RatingCode]: string };
};

/** The annex lines of a clause (AC-7): rateable ones with their own answer, the rest as context. */
function SubItems({ subItems, answers, locale, readOnly, handlers, ratingLabels }: SubItemsProps) {
  const t = useTranslations("assessments.item");
  return (
    <section
      aria-label={t("subItems")}
      className="flex flex-col gap-3 rounded-lg border border-dashed p-4"
    >
      <p className="text-muted-foreground text-xs">{t("subItemsLead")}</p>
      <ol className="flex flex-col gap-4">
        {subItems.map((sub) => {
          const subTitleId = `item-${slug(sub.id)}-title`;
          return (
            <li key={sub.id} data-item={sub.id} className="flex flex-col gap-3">
              <div className="flex items-baseline gap-3">
                <span
                  className="font-mono text-muted-foreground text-xs tabular-nums"
                  translate="no"
                >
                  {sub.label}
                </span>
                <span
                  id={subTitleId}
                  className={cn("text-sm", sub.rateable ? "font-medium" : "text-muted-foreground")}
                >
                  {sub.title[locale]}
                </span>
              </div>
              {sub.rateable ? (
                <AnswerFields
                  itemId={sub.id}
                  titleId={subTitleId}
                  answer={answers.get(sub.id) ?? EMPTY}
                  readOnly={readOnly}
                  handlers={handlers}
                  ratingLabels={ratingLabels}
                  compact
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
