"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export type FaqItem = {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
};

/**
 * The short FAQ of the pricing page (spec 0009, AC-6) on the shadcn accordion: one item per
 * question, the first open by default. The questions arrive as props from the server page, so
 * no message bundle reaches the browser for it. Browser.
 */
export function Faq({ items }: { readonly items: readonly FaqItem[] }) {
  const first = items[0];
  return (
    <Accordion type="single" collapsible defaultValue={first?.id}>
      {items.map((item) => (
        <AccordionItem key={item.id} value={item.id}>
          <AccordionTrigger className="text-base">{item.question}</AccordionTrigger>
          <AccordionContent>
            <p className="max-w-prose text-muted-foreground">{item.answer}</p>
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
