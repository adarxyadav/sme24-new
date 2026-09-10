import { RuledField } from "@/components/brand/ruled-field";
import { Statement } from "@/components/brand/statement";
import { SectionHeader } from "@/features/marketing/ui/section-header";

export type Step = {
  readonly key: string;
  readonly title: string;
  readonly body: string;
};

export type StepsSectionProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly steps: readonly Step[];
};

/**
 * "How it works" (spec 0009, AC-5): an ordered list of numbered steps, each a short campaign
 * statement with one sentence under it. This is the section that turns the argument on both
 * pages that use it, so it is the page's one ruled ground (docs/design.md, grounds) and opens
 * as a major. Server component.
 */
export function StepsSection({ eyebrow, title, steps }: StepsSectionProps) {
  return (
    <RuledField>
      <section aria-labelledby="steps-heading">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:gap-14 md:py-28">
          <SectionHeader tier="major" id="steps-heading" eyebrow={eyebrow} title={title} />
          <ol className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.key} className="flex flex-col gap-4 bg-background px-6 py-8">
                <span className="font-mono text-muted-foreground text-xs tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Statement
                  as="h3"
                  text={step.title}
                  className="font-semibold text-xl tracking-headline"
                />
                <p className="max-w-prose text-muted-foreground text-sm">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </RuledField>
  );
}
