import type { ReactNode } from "react";
import { Statement } from "@/components/brand/statement";

/**
 * The shell every legal page shares (spec 0015, AC-6): the eyebrow, the statement heading, the
 * lead and an optional dateline in the same band the marketing pages use, then the prose column
 * beneath it. One component so the four pages cannot drift apart, and so a section added to one
 * of them reads the same as every other. Server component.
 */
export function LegalPage({
  eyebrow,
  title,
  lead,
  meta,
  children,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly lead: string;
  /** The "last updated" line, and the version where a page has one. Omitted on the imprint. */
  readonly meta?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <>
      <section className="border-b">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-16 sm:px-6 md:py-24">
          <p className="eyebrow text-muted-foreground">{eyebrow}</p>
          <Statement as="h1" text={title} className="max-w-4xl text-display-sm md:text-display" />
          <p className="max-w-prose text-lg text-muted-foreground">{lead}</p>
          {meta ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">{meta}</p>
          ) : null}
        </div>
      </section>
      <div className="mx-auto flex max-w-3xl flex-col gap-12 px-4 py-16 sm:px-6 md:py-20">
        {children}
      </div>
    </>
  );
}

/**
 * One numbered-feeling section of a legal page: a heading the table of contents could point at,
 * an optional lead, and the body. The heading id is derived from the section key, so a link to
 * `#retention` keeps working as the text is rewritten. Server component.
 */
export function LegalSection({
  id,
  title,
  lead,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly lead?: string;
  readonly children?: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <Statement
        as="h2"
        id={`${id}-heading`}
        text={title}
        className="font-bold text-2xl tracking-headline md:text-3xl"
      />
      {lead ? <p className="max-w-prose text-muted-foreground">{lead}</p> : null}
      {children}
    </section>
  );
}

/** A paragraph of legal prose at the one measure every legal page uses. Server component. */
export function LegalProse({ children }: { readonly children: ReactNode }) {
  return <p className="max-w-prose text-base leading-relaxed">{children}</p>;
}
