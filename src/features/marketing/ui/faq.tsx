"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { CornerBrackets } from "@/features/marketing/ui/corner-brackets";

export type FaqItem = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
};

/**
 * The short FAQ of the pricing page (spec 0009, AC-6) on the shadcn accordion: one item per
 * question, the first open by default. The questions arrive as props from the server page, so
 * no message bundle reaches the browser for it. Browser.
 *
 * Framed like the trust band (owner decision of 2026-09-14, from a reference they brought): the
 * `border` hairline every marketing block uses, with `CornerBrackets` over it, so the FAQ reads as
 * one object rather than four rules floating in the column. The brackets are the same component
 * the trust band and the package card already share, so the three never drift.
 */
export function Faq({ items }: { readonly items: readonly FaqItem[] }) {
  const first = items[0];
  return (
    <div className="relative">
      <CornerBrackets />
      {/*
        The gutter sits on the frame rather than on each row, so the item dividers still run the
        full width of the block the way the reference draws them: padding the rows instead would
        inset every rule and leave the frame's own corners unmet.
      */}
      <Accordion type="single" collapsible defaultValue={first?.id} className="border px-6">
        {items.map((item) => (
          <AccordionItem key={item.id} value={item.id}>
            {/*
              `py-5` rather than the primitive's own `py-2.5`: this is a marketing band where the
              questions are the content, not a dense settings list. It is passed per call site, so
              the shared accordion's default is untouched in `/app`, `/expert` and `/admin`.
            */}
            <AccordionTrigger className="py-5 text-base">{item.question}</AccordionTrigger>
            <AccordionContent>
              <p className="max-w-prose text-muted-foreground">{item.answer}</p>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
