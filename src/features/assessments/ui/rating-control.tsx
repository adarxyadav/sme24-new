"use client";

import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { RATING_CODES, type RatingCode } from "@/features/assessments/catalogue";
import { cn } from "@/lib/utils";

export type RatingControlProps = {
  /** The id of the element naming this group (the item's title), for `aria-labelledby`. */
  readonly labelledBy: string;
  readonly value: RatingCode | null;
  readonly onValueChange: (rating: RatingCode) => void;
  /** The text of each segment, from the `assessments.ratings` keys. */
  readonly labels: { readonly [R in RatingCode]: string };
  readonly disabled?: boolean;
  readonly className?: string;
};

const ICONS = {
  compliant: CheckIcon,
  partial: MinusIcon,
  non_compliant: XIcon,
} as const;

/**
 * The colour of a chosen segment, one per rating, over the status tokens the badges already use.
 * The chosen state never rests on the colour alone (AC-13): the border darkens to the foreground,
 * the weight rises to medium and the icon fills, so a monochrome print still reads the choice.
 */
const CHECKED = {
  compliant:
    "data-[state=checked]:border-success data-[state=checked]:bg-success-subtle data-[state=checked]:text-success",
  partial:
    "data-[state=checked]:border-warning data-[state=checked]:bg-warning-subtle data-[state=checked]:text-warning",
  non_compliant:
    "data-[state=checked]:border-destructive data-[state=checked]:bg-destructive/10 data-[state=checked]:text-destructive",
} as const;

/**
 * The three way rating (spec 0019, AC-6, AC-13): a Radix radio group rendered as three labelled
 * segments, so arrow keys move between them, Space or a click chooses, and the chosen segment is
 * marked by its border and weight as well as its colour. Each segment is a real radio with its
 * text as its accessible name; the group takes its name from the item's title. Browser.
 */
export function RatingControl({
  labelledBy,
  value,
  onValueChange,
  labels,
  disabled = false,
  className,
}: RatingControlProps) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="rating-control"
      aria-labelledby={labelledBy}
      orientation="horizontal"
      value={value ?? ""}
      onValueChange={(next) => onValueChange(next as RatingCode)}
      disabled={disabled}
      className={cn("inline-flex max-w-full flex-wrap gap-1.5", className)}
    >
      {RATING_CODES.map((rating) => {
        const Icon = ICONS[rating];
        return (
          <RadioGroupPrimitive.Item
            key={rating}
            value={rating}
            data-rating={rating}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-sm transition-colors",
              "hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              "disabled:cursor-not-allowed disabled:opacity-60",
              "data-[state=checked]:font-medium data-[state=checked]:shadow-xs",
              CHECKED[rating],
            )}
          >
            <Icon
              aria-hidden="true"
              className="size-4 shrink-0"
              strokeWidth={value === rating ? 2.75 : 2}
            />
            {labels[rating]}
          </RadioGroupPrimitive.Item>
        );
      })}
    </RadioGroupPrimitive.Root>
  );
}
