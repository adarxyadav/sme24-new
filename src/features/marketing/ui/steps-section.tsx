import { Statement } from "@/components/brand/statement";
import { SectionHeader } from "@/features/marketing/ui/section-header";
import {
  StepVisual,
  type StepVisualKey,
  stepVisualBleeds,
} from "@/features/marketing/ui/step-visual";
import { StepsRail } from "@/features/marketing/ui/steps-rail";
import { cn } from "@/lib/utils";

export type Step = {
  readonly key: string;
  /** The two or three word label in the left column. The only place this step is named. */
  readonly label: string;
  /**
   * The step's sentence, opposite the label. The first sentence carries the claim and the rest
   * answer it in the muted colour, so one passage does the work a heading and a lead used to.
   */
  readonly body: string;
  /**
   * The still to set under this step. Omit it and the step is type only, which is what the
   * steps of a page that pictures nothing take.
   */
  readonly visual?: StepVisualKey;
};

export type StepsSectionProps = {
  readonly eyebrow: string;
  readonly title: string;
  readonly steps: readonly Step[];
};

/**
 * "How it works" (spec 0009, AC-5): the sequence read as a sequence. From `lg` the section pins
 * inside one frame and the steps change inside it -- the four labels stacked down the left, the
 * open step's sentence and picture on the right. Below `lg` the pin is dropped entirely and the
 * steps are the plain column of passages they have always been.
 *
 * The shape is the reference the owner brought on 2026-09-10, matched structurally rather than
 * borrowed loosely. Four things it fixes about the arrangement before it:
 *
 * 1. The left column names every step at every moment. It held numbers alone, so three of the
 *    four rows read as bare scaffolding -- "03", "04" and nothing to read -- and the reader could
 *    not see where the sequence was going. Names carry a sequence; ordinals only count it.
 * 2. One step is named once. The number and the title were two components saying the same thing,
 *    so the reader met a step twice and had to join the halves. The label is now the whole of the
 *    left column and the sentence is the whole of the right.
 * 3. The sentence opposite is two tone, not grey. Its claim sits in the heading colour and the
 *    rest runs on muted, which is what makes a three line passage carry a section on its own.
 * 4. The picture is wide and cropped at the frame's bottom edge rather than a small centred card.
 *    It reads as a window onto something larger, which is what a product still has to do; a
 *    contained thumbnail reads as an illustration of the copy instead.
 *
 * The section head spans the full width above both columns, under its own hairline, so it opens
 * the section rather than competing with the step labels inside the left column.
 *
 * The pin is a scroll track `steps.length` viewports tall with a sticky frame inside it, so the
 * browser does the pinning and no scroll handler ever moves the content: the rail's measuring code
 * decides only which step is opaque. Every step stays in the DOM and in the accessibility tree at
 * every moment -- the inactive ones are only dimmed, never unmounted or `inert` -- so a screen
 * reader still reads four steps in order and Ctrl+F still finds all four.
 * Server component; only the highlight is client side.
 */
export function StepsSection({ eyebrow, title, steps }: StepsSectionProps) {
  return (
    <section aria-labelledby="steps-heading" data-steps>
      {/*
        The scroll track. One viewport of scrolling per step, so each step gets an equal share of
        the reader's travel and the last one is fully read before the section releases. The height
        is inline because it counts the steps, which Tailwind cannot know at build time.
        Below `lg` the track collapses to `auto` and the frame stops sticking, so the whole
        mechanism disappears rather than being emulated on a phone.
      */}
      <div
        data-steps-track
        className="relative lg:h-(--steps-track)"
        style={{ "--steps-track": `${steps.length * 100}svh` } as React.CSSProperties}
      >
        {/*
          The sticky box ends where the consent bar begins: the bar is fixed to the bottom of the
          viewport from the root layout and publishes its height as `--consent-bar-height`
          (docs/design.md, spec 0015), so anything sized to the viewport must reserve it or the
          opaque bar lands on top of it. `top-16` clears the sticky header the same way.

          It is also the ruled frame (owner reference, 2026-09-10). From `lg` the section is drawn
          as one bordered panel rather than as copy floating on the page ground: this rule closes
          it top and bottom, the header's rule divides the head from the steps, and the right
          column's left rule divides the labels from what they open. The three together are the
          reference's own arrangement -- the frame is what makes a pinned section read as one
          object the reader is inside, rather than as a heading followed by four rows. The frame
          being the sticky box is the point: it is the part held still while the steps change.

          Only from `lg`, where the frame is: below it the section is a plain stacked column and
          an outer rule would box a page-width run of copy for no reason. `border-y` rather than
          `border`, because the box spans the full viewport width -- a left and right rule would
          sit hard against the window edge rather than reading as the sides of a panel.
        */}
        <div className="lg:sticky lg:top-16 lg:flex lg:h-[calc(100svh-4rem-var(--consent-bar-height,0px))] lg:flex-col lg:overflow-hidden lg:border-y">
          <StepsRail keys={steps.map((step) => step.key)} />
          {/*
            The head, spanning both columns above them and closed by a hairline -- the reference's
            own arrangement. It sat inside the left column before, where a section heading stood
            directly above a step heading and the reader met two titles in one stack.

            The rule is on the full-width wrapper and the copy is on the centred box inside it, so
            the hairline reaches the frame's left and right edges rather than stopping at the
            content width. On the centred box the head's rule and the frame's own rules were three
            different lengths and the vertical rule below ran past the end of this one, which read
            as a rule that had come loose rather than as the top of a panel.
          */}
          <div className="shrink-0 lg:border-b">
            <div className="mx-auto w-full max-w-6xl px-4 pt-16 pb-10 sm:px-6 md:pt-28 lg:px-12 lg:pt-10 lg:pb-10">
              <SectionHeader
                tier="major"
                id="steps-heading"
                eyebrow={eyebrow}
                title={title}
                emphasis={{ leadSentences: 1 }}
                className="**:data-[slot=statement]:text-display-sm **:data-[slot=statement]:md:text-display"
              />
            </div>
          </div>
          {/*
            Two columns from `lg`: the labels on the left, the open step's sentence and picture on
            the right. The right column is the wider of the two and the picture inside it runs to
            the frame's bottom edge, so the still is cropped by the viewport rather than sitting in
            it. Below `lg` neither the grid nor the pin exists and the steps stack down the page,
            which is the same information in the shape a phone can hold.
          */}
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 md:pb-28 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:items-stretch lg:gap-0 lg:px-12 lg:pb-0">
            {/*
              The labels. It is a real `ol`, so the numbering, the order and the count reach a
              screen reader from the markup rather than from any decoration -- which is why the
              visible ordinals could be dropped without the sequence losing its count.

              Every label is visible at every moment and only its colour follows the scroll: the
              reader sees the whole path and where on it they are, which is the one job this
              column has. The active label also carries the hairline marker, a ground change
              rather than a colour, because the palette has no accent hue (docs/design.md, rule 3).
            */}
            <ol className="flex flex-col border-border border-t lg:gap-1 lg:self-start lg:border-t-0 lg:pt-10 lg:pr-12">
              {steps.map((step, index) => (
                <li
                  key={step.key}
                  data-step={step.key}
                  data-step-index={index}
                  // Lit from the server, so without JavaScript every step stands open and the
                  // section is the plain column of passages it is below `lg`.
                  data-active="true"
                  className="group flex scroll-mt-28 flex-col gap-4 border-border border-b py-6 lg:border-b-0 lg:py-0"
                >
                  <div className="flex items-center gap-4 lg:gap-5">
                    <span
                      aria-hidden="true"
                      className="hidden h-6 w-px shrink-0 bg-transparent transition-colors duration-300 group-data-[active=true]:bg-foreground lg:block"
                    />
                    {/*
                      The label at body scale, not display: four of them are stacked and the
                      passage opposite is the line that should carry the section's weight. The
                      inactive ones drop to the faded ground the reference uses, which is what
                      makes the column read as a path rather than as four equal links.
                    */}
                    <span className="text-lg text-muted-foreground/50 transition-colors duration-300 group-data-[active=true]:text-foreground lg:text-xl">
                      {step.label}
                    </span>
                  </div>
                  {/*
                    The sentence and the still, below `lg` only. There is no second column at that
                    width, so the step carries its own; from `lg` both are hidden here and drawn on
                    the right instead, and exactly one copy of each string is ever displayed.
                  */}
                  <div className="flex flex-col gap-4 lg:hidden">
                    <Statement
                      as="p"
                      text={step.body}
                      layout="flow"
                      leadSentences={1}
                      className="max-w-prose text-copy-18"
                    />
                    {step.visual ? <StepVisual step={step.visual} className="w-full" /> : null}
                  </div>
                </li>
              ))}
            </ol>
            {/*
              The right column: the open step's sentence over its still, cross fading with the
              label opposite. It is not `aria-hidden`: each still carries a `role="img"` whose
              label says what it is a picture of (docs/design.md, the steps rail), and hiding the
              column would drop that label from every desktop reader -- the mobile copy of the
              same still is `display:none` at this width, so nothing here is announced twice.
              Hidden entirely below `lg`, where each still travels with its own step instead.
            */}
            {/*
              The right column carries the rule that divides it from the labels. It is a left
              border here rather than a column in the grid, because a rule has to sit at the
              boundary and the gap that used to hold the two apart had no edge to draw on: the
              gap is now this column's padding and the labels' `pr`, so the rule falls exactly
              between them and runs the full height of the frame (`items-stretch`) rather than
              stopping where the shorter column ends.
            */}
            <div className="relative hidden lg:block lg:border-l lg:pl-12">
              {steps.map((step, index) => (
                <div
                  key={step.key}
                  data-step-visual={step.key}
                  data-active="true"
                  className={cn(
                    "flex h-full flex-col gap-8 pt-10 opacity-0 transition-opacity duration-500 data-[active=true]:opacity-100",
                    index === 0 ? "relative" : "absolute inset-0",
                  )}
                >
                  {/*
                    The step's own sentence, two tone: the claim in the heading colour and the
                    rest running on muted, as one passage rather than a grey block. It is the same
                    string the row opposite renders below `lg`. The row is drawn whether or not the
                    step has a still, so a page that pictures nothing (`/how-it-works`) still has
                    its sentences here rather than losing them with the picture.
                  */}
                  <Statement
                    as="p"
                    text={step.body}
                    layout="flow"
                    leadSentences={1}
                    className="max-w-xl text-balance text-2xl leading-snug tracking-headline"
                  />
                  {/*
                    The still runs to the frame's bottom edge and is cropped there, which is what
                    makes it read as a window onto a real screen rather than as a thumbnail of one.
                    `min-h-0` is what lets the flex child actually be shorter than its content so
                    the crop happens; the overflow is clipped by the sticky frame above.
                  */}
                  {step.visual ? (
                    <div
                      className={cn(
                        // A photograph takes the rest of the frame and is cropped by its bottom
                        // edge; a card takes only the height its rows need.
                        stepVisualBleeds(step.visual) && "min-h-0 flex-1 overflow-hidden",
                      )}
                    >
                      <StepVisual step={step.visual} className="w-full" />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
