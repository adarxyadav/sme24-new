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
        className="relative lg:motion-safe:h-(--steps-track)"
        style={{ "--steps-track": `${steps.length * 100}svh` } as React.CSSProperties}
      >
        {/*
          The sticky shell ends where the consent bar begins: the bar is fixed to the bottom of the
          viewport from the root layout and publishes its height as `--consent-bar-height`
          (docs/design.md, spec 0015), so anything sized to the viewport must reserve it or the
          opaque bar lands on top of it. `top-16` clears the sticky header the same way.

          This element only positions; the frame is the centred box inside it. The two are separate
          because the shell has to be the full width of the viewport to be sized against it, and a
          border here would run the whole way across the window rather than closing a panel.

          `motion-safe` on the sticking and the viewport height, because both only exist to serve
          the pin: under `prefers-reduced-motion` the track above collapses to `auto`, and a frame
          still sized to one viewport inside an auto height track would crop three steps out of the
          panel with no scrolling left to reveal them. Dropped together, the section becomes the
          plain stacked panel it already is below `lg` -- every step open, nothing pinned.
        */}
        <div className="lg:motion-safe:sticky lg:motion-safe:top-16 lg:motion-safe:h-[calc(100svh-4rem-var(--consent-bar-height,0px))] lg:px-4 lg:py-6 sm:lg:px-6">
          <StepsRail keys={steps.map((step) => step.key)} />
          {/*
            The frame (owner reference, 2026-09-10): from `lg` the section is one closed rectangle
            at the content width, not copy floating on the page ground. `border` on all four sides
            is the point -- the panel is a rectangle the reader is inside, and the head's rule and
            the column rule divide it from within rather than reaching past it. An earlier pass put
            `border-y` on the full-width shell instead, which drew two rules across the window and
            read as the page being sliced rather than as a section being framed.

            Only from `lg`, where the pin is. Below it the section is a plain stacked column and a
            rectangle would box a page-width run of copy for no reason. The frame itself survives
            reduced motion -- it is drawing, not movement -- but its `h-full` and the `overflow-hidden`
            that crops the still do not: both size the panel to the viewport the pin gave it, and
            with the pin gone they would clip the steps instead of framing them.
          */}
          <div className="lg:mx-auto lg:flex lg:w-full lg:max-w-6xl lg:flex-col lg:rounded-lg lg:border lg:motion-safe:h-full lg:motion-safe:overflow-hidden">
            {/*
              The head, spanning both columns above them and closed by a hairline -- the reference's
              own arrangement. It sat inside the left column before, where a section heading stood
              directly above a step heading and the reader met two titles in one stack. The rule is
              the frame's own inner division, so it runs edge to edge of the panel and stops there.
            */}
            <div className="w-full shrink-0 px-4 pt-16 pb-8 sm:px-6 md:pt-28 lg:border-b lg:motion-safe:px-10 lg:motion-safe:pt-8 lg:motion-safe:pb-8">
              {/*
                Headline scale, not display, at every width. Inside the pinned frame the reason is
                height: the panel is one viewport tall and everything in it competes for that
                height, so a two sentence statement at `text-display` took roughly two fifths of
                the frame and pushed the still it introduces under the fold.

                A phone has the same problem for the same reason and did not get the same answer
                until 2026-09-10: the cap was written `lg:text-3xl`, so below `lg` the head kept
                the full 40px display scale and ran to 216px of heading inside a 366px head -- 43%
                of a 390x844 screen spent on the label of a section whose first step had not
                started. The head labels the panel; the step's own sentence is the line that
                carries the section, and it should be what the reader meets first.

                `md` keeps a step up, where the viewport is wide enough that the head is a band
                rather than a screen.
              */}
              <SectionHeader
                tier="major"
                id="steps-heading"
                eyebrow={eyebrow}
                title={title}
                emphasis={{ leadSentences: 1 }}
                className="**:data-[slot=statement]:text-2xl **:data-[slot=statement]:leading-tight **:data-[slot=statement]:md:text-3xl"
              />
            </div>
            {/*
              Two columns from `lg`: the labels on the left, the open step's sentence and picture on
              the right. The right column is the wider of the two and the picture inside it runs to
              the frame's bottom edge, so the still is cropped by the panel rather than sitting in
              it. Below `lg` neither the grid nor the pin exists and the steps stack down the page,
              which is the same information in the shape a phone can hold. Reduced motion takes that
              same stacked shape at every width: the two columns only make sense while one step at a
              time is open, and what opens them is the pin.
            */}
            <div className="w-full px-4 pb-16 sm:px-6 md:pb-28 lg:motion-safe:grid lg:motion-safe:min-h-0 lg:motion-safe:flex-1 lg:motion-safe:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:motion-safe:items-stretch lg:motion-safe:gap-0 lg:motion-safe:px-0 lg:motion-safe:pb-0">
              {/*
              The labels. It is a real `ol`, so the numbering, the order and the count reach a
              screen reader from the markup rather than from any decoration -- which is why the
              visible ordinals could be dropped without the sequence losing its count.

              Every label is visible at every moment and only its colour follows the scroll: the
              reader sees the whole path and where on it they are, which is the one job this
              column has. The active label also carries the hairline marker, a ground change
              rather than a colour, because the palette has no accent hue (docs/design.md, rule 3).
            */}
              <ol className="flex flex-col border-border border-t lg:motion-safe:gap-1 lg:motion-safe:self-start lg:motion-safe:border-t-0 lg:motion-safe:py-8 lg:motion-safe:pr-10 lg:motion-safe:pl-10">
                {steps.map((step, index) => (
                  <li
                    key={step.key}
                    data-step={step.key}
                    data-step-index={index}
                    // Lit from the server, so without JavaScript every step stands open and the
                    // section is the plain column of passages it is below `lg`.
                    data-active="true"
                    className="group flex scroll-mt-28 flex-col gap-4 border-border border-b py-6 lg:motion-safe:border-b-0 lg:motion-safe:py-0"
                  >
                    <div className="relative flex items-center gap-3 lg:motion-safe:gap-0">
                      {/*
                        The open step's marker, against the frame's left border rather than beside
                        the label (owner reference, 2026-09-10). `-ml-10` pulls it back through the
                        column's own `pl-10`, so it lands on the panel edge and the labels keep
                        their measure -- the reference hangs it in the margin, where it reads as
                        the frame marking its place rather than as a bullet before a word.

                        It carries the brand accent, the one decorative hue (docs/design.md, rule
                        3): the marker and the eyebrow pill are the same voice, and colour is not
                        the only carrier here -- the open label also goes to full foreground while
                        the rest stay muted.

                        Wherever there is no pin -- below `lg`, and at every width under reduced
                        motion -- every step is open at once, so an "open step" marker would light
                        all four and tell the reader nothing. There it is drawn on every step
                        instead, in the same accent and the same place, which is what gives four
                        equally lit steps an edge each to begin at: until 2026-09-10 it was
                        `lg:block` and a phone got no marker at all, so the four steps ran together
                        as one undifferentiated column of copy. It stays `aria-hidden` in both
                        roles -- the `ol` is what carries the count to a screen reader.
                      */}
                      <span
                        aria-hidden="true"
                        className="-ml-3 h-6 w-0.5 shrink-0 bg-brand-accent transition-colors duration-300 sm:-ml-4 lg:motion-safe:-ml-8 lg:motion-safe:absolute lg:motion-safe:bg-transparent lg:motion-safe:group-data-[active=true]:bg-brand-accent"
                      />
                      {/*
                      The label at body scale, not display: four of them are stacked and the
                      passage opposite is the line that should carry the section's weight. The
                      inactive ones drop to the faded ground the reference uses, which is what
                      makes the column read as a path rather than as four equal links.
                    */}
                      {/*
                        The closed labels run on the muted token itself, not on a fraction of it.
                        `muted-foreground` is `oklch(0.5)` in light and already sits close to the
                        AA floor on the panel's ground, so the `/50` this carried until 2026-09-10
                        halved it to roughly `oklch(0.75)` and put three of the four steps under
                        3:1 -- a path the reader cannot read is not a path. The open step is still
                        told apart from the closed ones, by the full foreground colour and the
                        hairline marker beside it, which is contrast enough without pushing the
                        others out of sight.
                      */}
                      {/*
                        Where every step stands open the label is the step's own title and has to
                        look like one: `font-semibold` at the headline's tracking, in the heading
                        colour. Inside the pin it goes back to being one of four entries in a path,
                        where weight would fight the open step's own sentence opposite, so the
                        semibold and the tracking are dropped from `lg` and the colour goes back to
                        following `data-active`.
                      */}
                      <span className="font-semibold text-foreground text-lg tracking-headline transition-colors duration-300 lg:motion-safe:font-normal lg:motion-safe:text-muted-foreground lg:motion-safe:text-xl lg:motion-safe:tracking-normal lg:motion-safe:group-data-[active=true]:text-foreground">
                        {step.label}
                      </span>
                    </div>
                    {/*
                    The sentence and the still, below `lg` only. There is no second column at that
                    width, so the step carries its own; from `lg` both are hidden here and drawn on
                    the right instead, and exactly one copy of each string is ever displayed.
                  */}
                    <div className="flex flex-col gap-4 lg:motion-safe:hidden">
                      <Statement
                        as="p"
                        text={step.body}
                        layout="flow"
                        leadSentences={1}
                        className="max-w-prose text-copy-18"
                      />
                      {step.visual ? (
                        <StepVisual step={step.visual} className="w-full" stacked />
                      ) : null}
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

              It also carries the rule dividing it from the labels: a left border here rather than
              a column in the grid, because a rule has to sit at a boundary and the gap that used
              to hold the two apart had no edge to draw on. The gap is now this column's padding
              and the labels' `pr`, so the rule falls exactly between them and runs the full
              height of the panel (`items-stretch`) rather than stopping at the shorter column.
            */}
              <div className="relative hidden lg:motion-safe:block lg:motion-safe:border-l">
                {steps.map((step, index) => (
                  <div
                    key={step.key}
                    data-step-visual={step.key}
                    data-active="true"
                    className={cn(
                      // The panel's inner padding lives on each step rather than on the column,
                      // because the stacked steps are `absolute inset-0` and so resolve against the
                      // column's padding box: padding set there is escaped by every step but the
                      // first, and the still runs under the frame's own border.
                      "flex h-full flex-col gap-8 px-10 pt-8 opacity-0 transition-opacity duration-500 data-[active=true]:opacity-100",
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
                          // A still that runs past the frame's bottom edge is cropped by it; one
                          // sized to its own rows takes only the height it needs. Every
                          // placeholder bleeds today, but the call stays per step so real artwork
                          // can go back to deciding for itself.
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
      </div>
    </section>
  );
}
