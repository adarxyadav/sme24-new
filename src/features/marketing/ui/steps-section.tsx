import { RuledField } from "@/components/brand/ruled-field";
import { Statement } from "@/components/brand/statement";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import { StepsRail } from "@/features/marketing/ui/steps-rail";

export type Step = {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  /** The two or three word name this step takes in the rail. Falls back to the title. */
  readonly label?: string;
};

export type StepsSectionProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly steps: readonly Step[];
  /** The rail's landmark name, e.g. "The four steps". */
  readonly navLabel: string;
};

/**
 * "How it works" (spec 0009, AC-5): the sequence read as a sequence. The steps stack as full
 * width passages the reader falls through one at a time, with a sticky rail beside them naming
 * where they are; the rail's highlight follows the panel currently level with the reader.
 *
 * Why the four across grid it replaced was wrong (2026-09-10): four equal cells side by side ask
 * to be compared, which is what a package grid wants and what a process does not. The steps are
 * ordered and each one only makes sense after the one above it, so they are set down the page in
 * that order, at a size that says the step titles are the argument rather than four captions.
 * This is still the section that turns the page, so it keeps the ruled ground and the major tier
 * (docs/design.md, tier map). Server component; only the rail's highlight is client side.
 */
export function StepsSection({ eyebrow, title, steps, navLabel }: StepsSectionProps) {
  return (
    <RuledField stickyChildren>
      <section aria-labelledby="steps-heading" data-steps>
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-16 md:py-28">
          <SectionHeader tier="major" id="steps-heading" eyebrow={eyebrow} title={title} />
          {/*
            The rail is a column of its own from `lg` and absent below it: a sticky index needs a
            viewport tall enough to hold both it and the panel it indexes, and on a phone the
            panels already arrive one per screen, which is the same information the rail carries.
          */}
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:gap-16">
            <StepsRail
              keys={steps.map((step) => step.key)}
              labels={steps.map((step) => step.label ?? step.title)}
              navLabel={navLabel}
              // `top-28` clears the sticky header (`h-16`) with the section's own breathing room
              // under it; `self-start` is what lets a grid child stick at all.
              className="hidden self-start lg:sticky lg:top-28 lg:block"
            />
            {/*
              One hairline between steps and none around them: the panels are a continuous run
              down one column, so a closed box on each would cut the sequence into four objects
              again. `divide-y` draws the three rules between the four.
            */}
            <ol className="divide-y divide-border border-t lg:border-t-0">
              {steps.map((step, index) => (
                <li
                  key={step.key}
                  data-step={step.key}
                  // `scroll-mt-28` matches the rail's own offset, so a fragment link or a
                  // keyboard landing puts the step below the sticky header rather than under it.
                  className="flex scroll-mt-28 flex-col gap-4 py-10 md:flex-row md:gap-10 md:py-14"
                >
                  {/*
                    The number sits in its own column from `md` rather than above the title, so
                    the four titles share one left edge and read as a list of claims; the figure
                    is the marker beside them, not a label stacked on top of each one.
                  */}
                  <span className="font-mono text-muted-foreground text-xs tabular-nums md:w-12 md:shrink-0 md:pt-2">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="flex min-w-0 flex-col gap-4">
                    {/*
                      Display sized, which is the whole point of the pass: at `text-xl` in a cell
                      the step titles were captions under a number. At this size the four titles
                      are the section's argument and the section header above them introduces it.
                      A step title is one or two short sentences, so `line` keeps the campaign
                      format and each sentence takes its own line and square stop.
                    */}
                    <Statement
                      as="h3"
                      text={step.title}
                      className="text-2xl tracking-headline md:text-display-sm"
                    />
                    <p className="max-w-prose text-copy-18 text-muted-foreground">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </RuledField>
  );
}
