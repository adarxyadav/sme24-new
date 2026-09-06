import { Statement } from "@/components/brand/statement";

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
 * statement with one sentence under it. Server component.
 */
export function StepsSection({ eyebrow, title, steps }: StepsSectionProps) {
  return (
    <section aria-labelledby="steps-heading" className="border-b">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 md:py-24">
        <div className="flex flex-col gap-3">
          <p className="eyebrow text-muted-foreground">{eyebrow}</p>
          <Statement as="h2" text={title} className="text-display-sm md:text-display" />
        </div>
        <ol className="grid gap-px border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.key} className="flex flex-col gap-4 bg-background px-6 py-8">
              <span className="font-mono text-muted-foreground text-xs tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <Statement
                as="h3"
                text={step.title}
                className="font-bold text-xl tracking-headline"
              />
              <p className="max-w-prose text-muted-foreground text-sm">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
