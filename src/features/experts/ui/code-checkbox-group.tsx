"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { cn } from "@/lib/utils";

export type CodeCheckboxGroupProps = {
  /** The catalogue codes this group offers, in the order the catalogue lists them. */
  readonly codes: readonly string[];
  /** The codes currently chosen; the parent form owns the array. */
  readonly value: readonly string[];
  readonly onValueChange: (value: readonly string[]) => void;
  /** Renders one code's label in the reader's language. */
  readonly labelFor: (code: string) => string;
  readonly legend: string;
  readonly description?: string;
  readonly error?: string;
  /** Prefix for every checkbox id, so two groups on one page never collide. */
  readonly idPrefix: string;
  /** Two columns by default; the 26 cantons want more. */
  readonly columns?: 2 | 3 | 4;
  readonly disabled?: boolean;
};

/**
 * A multi select over one catalogue list (spec 0013, AC-4, AC-5): a real `fieldset` with a
 * `legend`, one checkbox per code, labelled in the reader's language. A group rather than a
 * multi select listbox because every list here is short and fully known, and a checkbox group is
 * the control screen readers and keyboards already understand without any wiring of our own.
 *
 * The error message is bound to the fieldset with `aria-describedby`, so it reaches a screen
 * reader once for the group instead of once per checkbox. Browser.
 */
export function CodeCheckboxGroup({
  codes,
  value,
  onValueChange,
  labelFor,
  legend,
  description,
  error,
  idPrefix,
  columns = 2,
  disabled,
}: CodeCheckboxGroupProps) {
  const errorId = `${idPrefix}-error`;
  const descriptionId = `${idPrefix}-description`;
  const describedBy = [description ? descriptionId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ");

  const toggle = (code: string, checked: boolean) =>
    onValueChange(
      // Rebuilt from `codes` rather than appended to, so the saved order always matches the
      // catalogue order however the boxes were clicked.
      checked
        ? codes.filter((entry) => entry === code || value.includes(entry))
        : value.filter((entry) => entry !== code),
    );

  return (
    <FieldSet
      aria-invalid={error ? true : undefined}
      aria-describedby={describedBy || undefined}
      data-invalid={error ? true : undefined}
    >
      <FieldLegend variant="label">{legend}</FieldLegend>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      <div
        className={cn(
          "grid gap-x-4 gap-y-3",
          columns === 2 && "sm:grid-cols-2",
          columns === 3 && "sm:grid-cols-2 md:grid-cols-3",
          columns === 4 && "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
        )}
      >
        {codes.map((code) => {
          const id = `${idPrefix}-${code}`;
          return (
            <div key={code} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={value.includes(code)}
                onCheckedChange={(checked) => toggle(code, checked === true)}
                disabled={disabled}
              />
              <FieldLabel htmlFor={id} className="font-normal">
                {labelFor(code)}
              </FieldLabel>
            </div>
          );
        })}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </FieldSet>
  );
}
