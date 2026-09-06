import { Statement } from "@/components/brand/statement";

export type ClosingCtaProps = {
  readonly title: string;
  readonly lead?: string;
  /** The call to action: the lookup field on the landing page, a button elsewhere. */
  readonly children: React.ReactNode;
};

/**
 * The closing call to action of a marketing page (spec 0009, page composition): a statement on
 * the inverse block with the action under it. Server component.
 */
export function ClosingCta({ title, lead, children }: ClosingCtaProps) {
  return (
    <section aria-labelledby="closing-heading" className="dark bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-20 sm:px-6 md:py-28">
        <Statement
          as="h2"
          id="closing-heading"
          text={title}
          className="max-w-4xl text-display-sm md:text-display"
        />
        {lead ? <p className="max-w-prose text-lg text-muted-foreground">{lead}</p> : null}
        {children}
      </div>
    </section>
  );
}
