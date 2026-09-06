"use client";

import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export type CalculationDisclosureProps = {
  readonly title: string;
  /** Server rendered content: the formula, the assumptions, the inputs and the facts form. */
  readonly children: React.ReactNode;
};

/**
 * The "How this is calculated" disclosure (spec 0008, AC-10): a `Collapsible`, closed by
 * default, whose content the server renders from the snapshot blocks. Browser (open state only).
 */
export function CalculationDisclosure({ title, children }: CalculationDisclosureProps) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border"
      data-calculation-disclosure
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left font-medium text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        {title}
        <ChevronDownIcon
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-6 border-t px-4 py-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
