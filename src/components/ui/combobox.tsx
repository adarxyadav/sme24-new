"use client";

import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  readonly value: string;
  readonly label: string;
  /** A second line under the label: the company behind an organization, say. */
  readonly description?: string | null;
};

export type ComboboxProps = {
  readonly options: readonly ComboboxOption[];
  readonly value: string | null;
  readonly onValueChange: (value: string | null) => void;
  readonly placeholder: string;
  readonly searchPlaceholder: string;
  readonly emptyLabel: string;
  readonly id?: string;
  readonly name?: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
  /** The id of the FieldDescription that explains this control, so it reaches a screen reader. */
  readonly describedBy?: string;
  readonly className?: string;
};

/**
 * A searchable single select (spec 0013, AC-9): a button showing the current choice, opening a
 * filtered list. Composed from Popover and Command rather than a native select because the ops
 * organization picker has to be searchable, and a select with a hundred names is not usable.
 *
 * The trigger is a real button with `aria-expanded` and `combobox` semantics, and `cmdk` owns the
 * focus and active option wiring inside, so the keyboard behaviour is the library's rather than
 * something reimplemented here. A hidden input carries the value when the combobox sits in a plain
 * form; a React Hook Form field uses `onValueChange` instead. Browser.
 */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  id,
  name,
  disabled,
  invalid,
  describedBy,
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={describedBy}
            disabled={disabled}
            className={cn("w-full justify-between font-normal", className)}
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronsUpDownIcon className="ml-2 size-4 shrink-0 opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
          {/* The list is already filtered by the server on every keystroke for the organization
              picker, so cmdk's own scoring would filter the results a second time and hide
              matches the server deliberately returned. */}
          <Command shouldFilter={false}>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{emptyLabel}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => {
                      onValueChange(option.value === value ? null : option.value);
                      setOpen(false);
                    }}
                  >
                    <CheckIcon
                      className={cn(
                        "size-4 shrink-0",
                        option.value === value ? "opacity-100" : "opacity-0",
                      )}
                      aria-hidden="true"
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.description ? (
                        <span className="truncate text-muted-foreground text-xs">
                          {option.description}
                        </span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
