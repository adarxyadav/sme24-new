# SME24 design reference

_The file every page is built against. Spec: [0003 Design system and UI foundation](specs/0003-design-system/index.md). Token values live in `src/app/globals.css`; this file explains how to use them, it never repeats them._

- **source**: spec 0003 (with the brand amendment of 2026-09-04) and the SME24 Brand Identity Guidelines v1.0 (authoritative for mark, type, color, imagery and voice)
- **character**: authoritative, industrial, minimalist, high contrast. A serious B2B product for people who carry legal responsibility for safety. Pure black and white, obsidian for depth, hairline dividers, flat square-cornered surfaces, one typeface in a strong hierarchy. Nothing decorative that does not carry information. Voice: say less, mean more; no exclamation marks, buzzwords or emoji.
- **brand**: `src/components/brand/` (`BrandMark`, `Logo`, `Statement`, `Signature`), the gallery's Brand section, and `## Brand` below
- **tokens**: `src/app/globals.css` (`:root` light, `.dark` dark, exposed to Tailwind through `@theme inline`)
- **components**: `src/components/ui/` (shadcn, `radix-nova` preset), `src/components/` (shared primitives), `src/components/shell/` (signed in frame), `src/components/gallery/` (the gallery sections)
- **gallery**: `/admin/design` (ops only). A new primitive lands with its gallery section, or it escapes the axe scan.

## Build mandate

1. Compose from the inventory below. Do not invent a new control, layout or color when one exists here. If you need one, add it to `src/components/` with a gallery section and a line in this file.
2. Every visual value comes from a token: colors through `bg-*`, `text-*`, `border-*` utilities, spacing from Tailwind's default 4px scale, radius from the `rounded-*` scale. No raw `oklch()`, hex or pixel values in components.
3. One accent hue, and no more. The brand is black and white: `primary` is jet on white (white on jet in the dark theme) and marks primary actions, links (always underlined) and focus. Beyond that, `--brand-accent` (blue) is the single decorative hue, and it appears in exactly one role -- the section eyebrow, bare on a marketing page or as the emphasis pill (owner decision, 2026-09-10, amending the original "No accent hue"). Status and severity colors are the only other hues, they always sit next to a label or an icon, and they are never borrowed for decoration: `--brand-accent` exists as its own token precisely so a decorative label cannot spend `--info`, which has to keep meaning Notice. Color is never the only carrier of meaning.
4. Every user facing string goes through next-intl (`messages/de.json` is the authoritative key set, `messages/en.json` mirrors it; `tests/messages.test.ts` fails when they drift).
5. WCAG 2.2 AA is the floor: visible focus, keyboard operable, announced states. The contrast gate (`tests/contrast.test.ts`) runs on every commit; axe runs on the gallery in Playwright.

## Brand

The mark, the lockup and the campaign language live in `src/components/brand/` and are checked in the gallery's Brand section.

| Element | Component | Rules |
|---|---|---|
| Mark | `BrandMark` (`variant="bare" \| "badge" \| "keyline"`) | Draws in `currentColor`; the badge knocks the mark out of the circle, so the four approved variants are pure `text-*` and `bg-*` choices: black on white (`text-jet` on `bg-pure-white`), white on jet, badge black on white, badge white on obsidian. Decorative (`aria-hidden`) unless you pass `title`. Never recolored, stretched, rotated, shadowed or placed on a busy ground. Keep 30px clear space and never render under 80px wide as a standalone badge; in lockups and the sidebar it sits next to the visible name. |
| Lockup | `Logo` (`variant`, `size="sm" \| "md" \| "lg"`, `descriptor`) | Mark plus the wordmark "SME24" in Geist 600 with display tracking (800 until the 2026-09-10 weight cap; the brand guidelines v1.0 still say 800 and owe an amendment); `descriptor` adds "EHS CONSULTING" tracked at `tracking-lockup`. Primary lockup is bare, alternate is the badge. Used in the marketing header and sign in (`size="md"`); the sidebar shows the bare mark beside the name. |
| Statement | `Statement` (`text`, `as`) | Campaign copy: each sentence on its own line, closed by the square stop (`SquareStop`, a solid square on the baseline with an `sr-only` period). Pair with `text-display-*` or a headline size. "Senior experts. No slides. Just results." |
| Signature | `Signature` | The badge beside "SME24. Einfach. Anders." / "SME24. Just. Different." (`brand.signature`). Closes marketing pages and campaign blocks. |
| Inverse block | `className="dark bg-background text-foreground"` on a section | The jet black ground in both themes (the brand's 30% jet). The `.dark` token block applies to the subtree, so every component inside keeps working. The closing call to action of every marketing page is one; the landing hero sits on the page ground. |
| Campaign piece | `CampaignPiece` (`statement`, `subline`, `as`, `signature`) | The campaign format from the decks: one object on pure white, the statement in display size closed by the square stop, an italic parenthetical subline ("(Auch vegan)."), the signature bottom left. Pieces are artifacts and stay white with jet ink in both themes. Without children it is the type only piece ("No slides. Results.") at the larger display size. |
| Campaign frame | `CampaignFrame` (`caption`, `aspect`, `empty`, `placeholder`) | One object slot, optionally with a caption statement above it ("Graue Haare."; a caption without a period, like "AI", stays bare). `empty` draws the hairlined blank frame of the AI contrast; `placeholder` is for development only and never ships. The deck's own objects live in `public/campaign/` (web sized, 1200 to 1600px) and the gallery composes every format from them. Put a `CampaignImage` inside: `next/image` filling the frame, `object-contain`, `grayscale` for people and places (imagery rule), objects keep their color. |
| Campaign grid | `CampaignGrid` (`columns` 2, 3, 4) | Frames side by side: a pair, the contrast, or four panels (two columns wrap to two rows). |
| Campaign wall | `CampaignWall` | Pieces tiled with hairlines for a marketing section; pass `signature={false}` to the pieces and sign the page once in the footer. |
| Eyebrow | `eyebrow` utility | Caption · 500 · caps · `tracking-caps`: section labels, descriptors, the footer line. Pair with `text-muted-foreground`. |
| App icon | `src/app/icon.svg` | The circled badge, black on transparent. |

The mark path in `brand-mark.tsx` is traced from the guidelines; the official file from the asset kit (service@sme24.ch) replaces that one string when it arrives. Imagery, when it comes with feature 13, is black and white or heavily desaturated, shot on site, architectural crops.

## Type

One typeface: Geist (Google Fonts, self hosted through `next/font` in `src/app/[locale]/layout.tsx`, fallback Helvetica and Arial) for everything, Geist Mono for identifiers, run ids and code. The variables sit on `html`, so `font-sans` applies everywhere.

| Role (brand hierarchy) | Classes |
|---|---|
| Display · 450 · −3% | `text-display-lg` (72px), `text-display` (56px), `text-display-sm` (40px); weight and tracking are built into the size. Marketing statements and campaign blocks. The weight dropped from 600 to 450 on 2026-09-10 (owner decision): Geist carries a 100–900 weight axis and no width axis, so weight is the only lever on how heavy a statement sits, and 450 is a real point on that axis rather than a snap to 400 or 500. |
| Headline · 600 · −2% (`h1`, rendered by `PageHeader`) | `text-2xl font-semibold tracking-headline` |
| Subhead · 600 (`h2`) | `text-lg font-semibold` |
| Card title | `text-base font-semibold` |
| Body · 400 | `text-sm` (14px) |
| Secondary | `text-xs text-muted-foreground` |
| Caption · 500 · caps | `eyebrow text-muted-foreground` |
| Identifiers, code | `font-mono text-xs` |
| Numbers in tables and KPI tiles | add `tabular-nums` (or `data-numeric`) so figures align |

Prose blocks cap at `max-w-prose`. Exactly one `h1` per page. Heading levels never skip.

### The scale

The role table above is the shorthand; underneath it sits a four-family scale adapted from the Geist
design system (2026-09-09). A size alone is not a style -- the same 14px is a nav item, a button and
a paragraph, and those want different line heights -- so each token presets size, line-height,
letter-spacing and weight together. A call site names a role rather than assembling one:
`text-copy-14`, not `text-sm leading-relaxed font-normal`.

| Family | Sizes | Metrics | Use for |
|---|---|---|---|
| `text-heading-*` | 72, 64, 56, 48, 40, 32, 24, 20, 16, 14 | 600, leading 1–1.5, tracking −4.5% to −0.4% | Headings only. Tight leading hurts to read in bulk. |
| `text-copy-*` | 24, 20, 18, 16, 14, 13 | 400, leading 1.5 | Multiple lines: paragraphs, marketing prose, email body. |
| `text-label-*` | 20, 18, 16, 14, 13, 12 | 400, leading ~1.25 | Single lines: nav, menus, table headers, form labels, badges. |
| `text-button-*` | 16, 14, 12 | 500, label metrics | Control labels. 12 only for a button inside an input. |
| `text-copy-13-mono`, `text-label-{14,13,12}-mono` | — | Geist Mono, tabular figures | Run ids, invoice numbers, amounts. Half a step below the sans size they pair with, because Geist Mono's x-height reads bigger at the same nominal size. |

Choosing between them is one question: **does it wrap?** More than one line is `copy`, one line is
`label`, and a heading is `heading` at any length. Tracking tightens as the size grows and turns
positive again below 16px, which is what keeps a large heading from reading loose and small text
from reading cramped; never override it by hand.

Emphasis inside these families is markup, not a second class. `<strong>` (or `<b>`) nested in any
`heading`/`copy`/`label` element goes to 600 at the same size, and `<span className="subtle">` goes
to the muted token — so `<p className="text-copy-16">Copy <strong>with Strong</strong></p>` needs
nothing on the child.

The brand `text-display-*` tokens are unchanged and still outrank `text-heading-*` for marketing
statements and the campaign blocks: `heading` is the working scale, `display` is the voice. The
plain Tailwind ramp (`text-sm`, `text-lg`) still works and is what most existing call sites use;
new UI takes the scale above, and old call sites move with the file when it is next touched.


## Color

Semantic tokens only, named like shadcn so the installed components keep working. Every name below exists in `globals.css` in both themes. The palette is the brand's Jet Black `#000000`, Pure White `#FFFFFF` and Obsidian Black `#141414` in the proportion white 60, jet 30, obsidian 10: in the light theme the page is white and the sidebar is a light gray of the same family (owner decision of 2026-09-04, the jet share moves to the mark, text and the active item); in the dark theme the page is jet and cards, popovers and the sidebar are obsidian. The three brand constants exist as `jet`, `pure-white` and `obsidian` utilities for the places where the guidelines fix the ground (mark variants, campaign pieces); everything else uses the semantic tokens.

| Group | Tokens | Use |
|---|---|---|
| Ground | `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground` | Page and surfaces. Cards are flat: hairline, no shadow. Dark surfaces are obsidian on the jet page. |
| Subtle | `muted`, `muted-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground` | Subtle fills, secondary text, hover fills. Secondary text still passes 4.5:1. |
| Lines | `border`, `input`, `ring` | `border` is the decorative hairline. `input` outlines a control and `ring` is the focus ring; both reach 3:1 on every ground. |
| Brand | `primary`, `primary-foreground` | Jet on white, white on jet in the dark theme. Primary buttons, underlined links, active navigation. |
| Status | `success`, `warning`, `info`, `destructive`, each with `-foreground` and `-subtle` | Solid fill with `-foreground` text; `-subtle` tint with the fill color as text (`bg-success-subtle text-success`). |
| Severity | `severity-critical`, `severity-high`, `severity-medium`, `severity-low`, each with `-foreground` and `-subtle` | Gap findings and benchmark levels, always with the level label. |
| Charts | `chart-1` to `chart-5` | Series in order: ink (jet or white), mid gray, light gray, slate blue, amber. Monochrome first, hues only from the fourth series on; never red beside green. |
| Sidebar | `sidebar`, `sidebar-foreground`, `sidebar-muted-foreground`, `sidebar-primary`, `sidebar-primary-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring` | The signed in navigation, light gray in the light theme and obsidian in the dark theme. Inside the sidebar use `sidebar-*` tokens only; `muted-foreground` belongs to the page. |
| Brand constants | `jet`, `pure-white`, `obsidian` | Fixed in both themes. Only where the brand guide fixes the ground. |

**Contrast rule.** `src/lib/design-tokens.ts` lists every guaranteed pair. Text pairs must reach 4.5:1; `input`, `ring` and `chart-1` to `chart-5` on every page ground and `sidebar-ring` on the sidebar grounds 3:1. `border` and `sidebar-border` are decorative hairlines and stay outside the gate (WCAG 1.4.11 covers control boundaries and informative graphics, not dividers; spec 0003, amendment of 2026-09-04). No text token is treated as large text. Translucent values are composited over their ground before measuring, `color-mix` is evaluated from the two colors. If you change a value, keep the hue and let the test decide. The gallery shows the live ratio next to every swatch.

**Theme.** `next-themes` writes `light` or `dark` on `html`; the default follows the system. `:root` sets `color-scheme: light` and `.dark` sets `color-scheme: dark`, so native controls follow. The preference lives in `localStorage.theme`, per browser by design. Nothing reads or writes theme state except through `next-themes` (`ThemeToggle`, `ThemeSubmenu`).

## Spacing, layout and radius

- Tailwind's default 4px scale, no custom steps.
- Page gutter `px-6` (`px-4` under 640px), sections `gap-8`, inside cards `p-6`, between form fields `gap-4`. `PageStack` applies the page values.
- Widths: signed in content `max-w-7xl` (in `PageStack`), marketing `max-w-6xl`, forms `max-w-2xl`.
- Control heights: the preset's 32px default. Marketing calls to action use `size="lg"`.
- Radius `0.125rem` (`--radius`): block forms like the mark, corners barely softened so hairlines render cleanly. The preset derives `rounded-sm` to `rounded-4xl` from it, so even badges are rectangles.
- Elevation: none on cards. Overlays (dialog, sheet, popover, menu) use the preset's shadow.

## Marketing section vocabulary

_Decided 2026-09-07, before the section by section refinement of the public site. It applies to `src/app/[locale]/(marketing)/` and the sections in `src/features/marketing/ui/`; the signed in areas keep the page anatomy below. The reason it exists: the first build gave all 23 bands one rhythm (`py-16 md:py-24`) and all 20 headings one size (`text-display-sm md:text-display`), so every section claimed equal weight and the pages read as a metronome. Tier is the one decision per section; rhythm, heading size and opener shape all follow from it. Ground is the second, independent axis._

### Tiers

Every marketing section is an anchor, a major or a minor. A page opens with an anchor, carries two or three majors and puts supporting content in minors.

| Tier | Padding | Heading | Use |
|---|---|---|---|
| Anchor | `py-24 md:py-40` | `h1` `text-display-sm md:text-display-lg` | The page opener and the closing call to action. One or two per page, never more. |
| Major | `py-16 md:py-28` | `h2` `text-display-sm md:text-display` | The two or three sections that carry the page's argument. |
| Minor | `py-12 md:py-20` | `h2` `text-2xl md:text-display-sm tracking-headline` | Supporting bands: a list of inclusions, timings, coverage, an FAQ. |

A minor's heading never scales past `text-display-sm`, which is what keeps a long page from reading flat. Cells inside a band keep `px-6 py-8`; the tier sets the band's own padding only. The container stays `mx-auto max-w-6xl px-4 sm:px-6` at every tier.

### Grounds

Ground is chosen independently of the tier, and jet stays rare so it keeps meaning.

| Ground | Markup | Rule |
|---|---|---|
| White | (default) | Every section that is not one of the two below. |
| Ruled | `RuledField` | The one section per page that turns the argument (the campaign grid on about). At most one per page, never adjacent to another non white ground. The landing hero keeps its own `hero` field; the steps came off the ruled ground on 2026-09-10, see `### The steps rail`, and the expert network's vetting ladder came off it on 2026-09-14 for the same reason: behind a band whose own content is a four cell hairline grid, the vertical rules read as a second grid competing with the one that carries the sequence. About is the only page still using it. |
| Jet | `className="dark bg-background text-foreground"` | The page opener when it is a hero, and the closing call to action. Structural bookends, never mid page. A jet opener also carries `hero` on its `RuledField` and its route joins `DARK_HERO_ROUTES` so the header holds its inversion. |

### Openers

The opener follows from the tier, so there is nothing extra to decide per section.

| Tier | Opener |
|---|---|
| Anchor | Stacked and left aligned: eyebrow, `Statement`, lead paragraph, `gap-6`. |
| Major | Split: eyebrow and `Statement` in the left column, the lead in the right (`lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`). The lead is optional; without one the heading spans. |
| Minor | Inline, no eyebrow: heading and lead on one row (`md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`), wrapping to two rows below `md`. |

`SectionHeader` in `src/features/marketing/ui/` renders all three from a `tier` prop; a page composes it rather than hand rolling the markup. A section that is deliberately different (the campaign wall, the packages grid) may still open with its own markup, but it picks one of the three shapes. The anchor has two variations on its stack rather than a fourth shape: `align="center"` centres it (`### Centred openers`), and the pill and the flowed heading may be taken on their own with the left edge kept, which is the same stack with a different eyebrow and one fewer line break.

The pricing page's packages band is openerless for a second reason (owner decision of 2026-09-14): its content is the four package cards, each with its own `h3`, price and promise, and the centred `h1` directly above already says what they are. It carried a major opener from 2026-09-10, added when the `h1` shared the band and the cards had no heading of their own; once the opener moved into its own band and went centred, the display heading in between was a third statement between two things that already spoke, and it pushed the prices most of a screen down. The heading survives as `sr-only`, so the landmark keeps its name and the `h3` cards keep a level above them. A band that drops its opener this way also drops the padding that opener needed -- the tier's top padding exists to clear its own content, and with nothing there it stacks with the band above into dead white.

One band is deliberately openerless for a different reason: the landing page's worked figure, the passage between the hero and the steps (2026-09-10). It is one sentence with the figure set inside it and nothing else -- no opener, no footnote and no link -- and it carries an `sr-only` `h2` so the landmark is still named. A minor opener above one sentence re-created the stack -- heading, lead, figure, footnote -- that three passes had already been spent removing, on a band a reader crosses rather than stops at.

The expert network's example profiles are the third (owner decision of 2026-09-14). They carried a major opener -- "Who turns up. Six examples." over a lead -- until then, and what it announced the page already says: the cards sit directly under the hero, whose `h1` is "Senior people. No juniors.", and six cards each naming a person, a discipline and a canton are what that claim is about. Like the pricing packages it drops its top padding and keeps its bottom one. The hero's control at the foot of the anchor above looked at first like a reason to keep both, on the reading that the space was separating a button from a grid; rendered, the anchor's `md:py-40` bottom and this band's `md:py-28` top stacked into 272px of white that read as a missing section. The rule holds without the exception: the tier's top padding clears the band's own opener, and an openerless band has nothing up there to clear.

The band's visible disclosure went with the opener on the same decision, and that one left a gap rather than closing one. The six profiles are invented, and the line that said so -- "Example profiles, in the shape a real one takes." -- was the only place a sighted reader was told. What remains is `sr-only`, so assistive tech is told and the page is not; the `note` key stays in both catalogs so restoring the line is one element. It goes back before launch or when real experts replace the fixtures, whichever is first.

The line was restored and removed again on 2026-09-14 (owner decision), so this gap is open rather than closed and the round trip is worth recording: it is the one item on this page whose cost is not visual. Six invented people -- `M. Muster`, `A. Beispiel` and four more -- carry years of experience, a sector, a canton, standards and working languages on a public page, and only a screen reader is told they are examples. `ExpertProfiles` holds the exact element to restore in a comment beside the gap.

A section may drop its opener in exactly three cases: it is a single sentence long; its content is a set of cards that each carry their own heading and the band directly above it has already named them (the pricing packages, above); or its content is a set of cards that each carry their own heading and the page's `h1` immediately above has named them (the expert profiles). Anything else takes one of the three shapes above, and all three cases still carry an `sr-only` heading so the landmark keeps its name.

### The steps rail

`StepsSection` (both the landing page and how it works) sets its steps as full width passages down one column with a sticky rail beside them, rather than as the four across grid it was until 2026-09-10. The reason is that the content is a sequence: four equal cells side by side ask to be compared, which is what the packages grid wants and what a process does not, and at `text-xl` in a cell the step titles were captions under a number rather than the section's argument. The titles now take `text-2xl md:text-display-sm`, the number moves into its own column so the four titles share a left edge, and a single hairline runs between steps instead of a closed box around each.

The section sits on the page ground, not the ruled one (owner decision of 2026-09-10). The rules run vertically, and once the steps became a column the reader travels down rather than a row they scan across, a field of vertical lines behind that column read as a second grid competing with the one hairline that actually carries the sequence. The landing page therefore has no ruled section at all now; the ruled ground stays what it was for, the one section per page that turns the argument, on the pages that still use it.

The rail (`StepsRail`, the section's only client component) names the four steps and highlights the one the reader is level with. It is a position indicator for content the server already rendered in full, so it is `aria-hidden` -- it duplicates the panel headings, nothing in it is focusable, and a screen reader reads the panels in order without it -- while its `nav` keeps a name so the landmark is not anonymous. Below `lg` it is absent: a sticky index needs a viewport tall enough to hold both it and the panel it indexes, and on a phone the panels already arrive one per screen.

Every step carries a still (`StepVisual`, 2026-09-10). Two of the four have a real screen and are drawn from that screen's own components and strings, the way the hero object is: the benchmark still is the dashboard's own `QuartileBand` on the section C row of `supabase/seed-data/benchmarks.csv` (p25 34.9, median 49.9, p75 66.4) with the annual cost the worked-figure sentence one section above already prints, so the band and that sentence describe one company and a test in `tests/features/benchmark/seed.test.ts` fails if the CSV and the still ever disagree; the package still lists `PACKAGES` at its real prices under the catalog's own `shortName` keys.

The other two steps have no screen to picture -- step 01's screen is the hero object a few hundred pixels above, and a site visit is not a screen at all -- so they take campaign photography rather than an invented screenshot, which is the mistake `HeroBenchmark` was removed for. Those two are set `object-contain` on a `bg-pure-white` panel, because the campaign objects are cut out on white: `object-cover` on a full length coverall keeps a torso and two legs and reads as a pair of trousers. Grayscale follows the imagery rule and not the slot, so the expert's portrait is black and white and the coverall's reflective stripes stay orange.

Stills alternate sides down the column. Four stills on one edge turn the sequence into a two column table the eye reads across; the zig zag keeps the reader travelling down. Every still is `inert` under one `role="img"` whose label says what it is a picture of, so no figure inside is ever announced as though it were the reader's own. The `visual` prop is optional, and `/how-it-works` passes none: its steps are the same four stages in more words, and repeating the landing page's pictures there would say nothing new.

One mechanic is load bearing: the highlight is measured from the panel tops against a line at 40% of the viewport, with the `IntersectionObserver` only as the trigger and a rAF coalesced `scroll` listener beside it. With four short panels several are on screen at once, so "which one is intersecting" has no single answer, and a scroll between two thresholds fires no observer callback at all.

The pin is dropped, not shortened, under `prefers-reduced-motion` (2026-09-10). The global rule in `globals.css` clamps every transition to 1ms, which took the cross fade away and left the scroll pin itself untouched, so the reader who asked for less motion got four viewports of scroll hijacking with none of the fading that explained what it was for -- worse than either end of the choice. The pin is the motion here: it takes the page's own scrolling away and spends it on the section. Every utility that exists only to serve it therefore carries `motion-safe` (the track height, the sticky shell and its viewport height, the frame's `h-full` and `overflow-hidden`, the two column grid and the right hand column), and `StepsRail`'s own media query carries `prefers-reduced-motion: no-preference` beside the width, so the driver and the layout agree on when there is a pin. What is left under reduced motion is the stacked column the section already is below `lg`: every step open, the frame still drawn, nothing pinned. The frame survives because it is drawing rather than movement.

Below `lg` -- and now at every width under reduced motion -- each step carries its own marker in the brand accent rather than the open step alone (2026-09-10). Wherever there is no pin every step stands open at once, so an "open step" marker would light all four and say nothing; it was `lg:block` until then, so a phone got no marker at all and the four steps ran together as one undifferentiated column of copy. The label takes `font-semibold` at the headline tracking in the same places, because there it is the step's own title rather than one entry in a path, and the still drops from the pinned column's height to a ground that sizes to its card between a 16rem floor and a 32rem cap and crops the rest at the bottom (`StepVisual`'s `stacked`, 2026-09-13; it was a fixed 16:9 band capped at 16rem with nothing clipping it, so the cards spilled over the step's heading and the next step) -- four stills at the panel's height made the section four screens of grey on a phone, one per step. The panel head takes headline scale at every width for the same reason the pinned frame gives it one: at the full 40px display scale it ran to 216px of heading inside a 366px head, 43% of a 390x844 screen spent on the label of a section whose first step had not started.

On `/how-it-works` the panel takes its own eyebrow and title (`marketing.howItWorks.steps.panel.*`) rather than the shared `steps.eyebrow` and `steps.title` the landing page uses. Those announce the process, which is right where the reader meets it for the first time and wrong under an `h1` that has just said "Four steps. One report.": the reader met "four steps" twice inside one screen and the second heading carried no news. The panel's job on that page is to start the sequence, not to announce it.

One trap worth remembering if this section ever goes back onto a ruled ground: `RuledField` carries `overflow-hidden`, which gives the element a scrolling mechanism, and a `position: sticky` descendant anchors to that nearest scrolling ancestor instead of the viewport, so the rail silently never moves. `overflow-clip` is deliberately excluded from that list and clips identically (MDN, `position`).

### Filtering a static band

_Owner decision of 2026-09-14, from a reference brought that day. `ExpertProfilesFilter` is the only one on the site._

The expert network's profiles band carries a `Tabs` row above the grid: All plus one tab per competency. `Tabs` rather than a row of buttons, because Radix brings the roving tabindex, the arrow keys and `aria-selected` that a hand rolled row gets wrong.

Three rules hold, and a second such filter takes all three:

**The cards stay server rendered.** The filter writes `data-competency` to the grid and a `<style>` block beside it hides what does not match; it never renders the list. All six cards are therefore in the prerendered HTML, a crawler indexes six profiles, and the first client paint matches the server's markup because nothing is hidden until the attribute is written.

**The control is drawn only once it can act.** It returns `null` until mounted. Without JavaScript the tabs would render and do nothing, and a dead control reads as a broken page where six unfiltered cards read as the whole set. The margin rides on the control, not a wrapper, or its absence leaves an empty band.

**The state mirrors to the query string, one way and browser only.** Read from `window.location` after mount, written with `history.replaceState` — the shape `RegisterDirectory` already uses. `useSearchParams` would force a `Suspense` boundary into a server page the component does not own, and these routes are static (`src/features/marketing/AGENTS.md`).

The labels arrive as props. Only the shared namespaces reach the browser (spec 0004, AC-6), and `experts.catalogue` is not one: it carries every standard, NOGA section and canton, so shipping it for four chips would spend a large namespace on a page with a 250 kB budget. The record's type is what keeps the tabs in step with `COMPETENCY_CODES` — a fourth competency fails to compile rather than shipping a chip with no label.

### Centred openers

_Owner decision of 2026-09-14, from a reference brought that day._

`SectionHeader` takes `align="center"`, which centres an anchor's whole stack -- eyebrow, heading and lead on one axis rather than one left edge. It is opt in, anchors only, and left stays the default: the site reads left everywhere, which is exactly what lets a centred section mean something. There are three on the site and there should not be a fourth without a reason: the landing page's trust band, the pricing page's opener and the expert network's opener.

The pricing opener earns it by being the shortest `h1` on any marketing page -- "Fixed price. No surprises." -- over a one line lead. Left aligned, four words of display type left most of a `py-24 md:py-40` band empty to the right; centred, they sit as a plate over the prices below.

The expert network opener earns it the same way and for that reason only (owner decision of 2026-09-14): "Senior people. No juniors." is four words of display type that left the same band empty to the right. What does not transfer is the second half of the pricing argument -- the plate there sits over the prices, and here the band below is "the standard", which opens with a major of its own. The centring is justified by the heading's own length, not by what follows it, and a left aligned major under a centred anchor is the composition this page introduced.

Its lead is the one part the centred defaults do not fit. `max-w-136` was measured against the pricing lead, one sentence of 467px that sits on one line at desktop widths; the expert lead is two sentences (EN 1049px, DE 1128px unwrapped) and at that cap turned twice, stranding a two word orphan on a third line in both catalogs. The call site overrides it to `max-w-2xl` (672px) through the lead's `data-slot`, the widest step that still reads as a plate and the first that holds both languages to two balanced lines (second line 382px of 672 in English, 494px in German). The override is one section's measure, not a change to the tier -- the default stays what pricing needs -- and it is checked in both catalogs, so re-measure if this copy changes.

A centred anchor also flows its heading rather than breaking at every sentence, and caps its lead at `max-w-136` instead of `max-w-prose`. Both follow from the shape: the plate wants a wide short heading over a narrower lead, and `max-w-prose` (~65ch) is wide enough that a wrapping lead turns too far from the centre to read as one block. The cap is a ceiling and not a break point -- the pricing lead is one sentence and sits on one line at desktop widths, wrapping only on a phone.

The heading's cap widens to `max-w-5xl` with it, and the width is measured rather than chosen. Flowed at `display-lg` the English opener is 833px on one line: `max-w-4xl` (896px) holds that, but only just, and a cap that close to the text wraps on the first longer translation. The German opener is 1060px on one line -- wider than the 1104px band's usable width once the gutters are off it -- so it can never be one line here and the only question is whether it wraps cleanly or overflows. `max-w-5xl` (1024px) clears English and wraps German to two balanced lines. The heading is one component serving both catalogs, so the cap has to be a width neither language fights; check both when this copy changes.

A centred anchor's eyebrow is the accent pill (the gallery's Accents row, `Badge variant="brand-accent"` at the caps scale) rather than the bare caps line every left aligned opener uses. Centred, a bare caps line has no left edge to sit on and reads as a stray word floating above the heading; the pill gives it an object's shape. It is the same `EYEBROW_PILL` the emphasis shape uses, so there is one pill on the site and not two that drift, and `--brand-accent on --brand-accent-subtle` is already in the contrast gate in both themes.

A left aligned anchor may take the pill and the flowed heading without the centring (owner decision of 2026-09-14). The expert network's opener is the reference and the directory is the only call site: the pill and the flow are the opener's own shape, the centring is its axis, and the two come apart. The directory takes the first and not the second because the page is a register -- a ledger of four figures over a canton grid over a filterable table, all left edged -- so a centred plate would be the one block on it not sitting on that edge. It also takes no control, where the reference carries one: that button points at the directory, and the directory is already the register.

The heading flows through `layout="flow"` on `SectionHeader`, which is opt in, anchors only, and leaves `line` the default so every existing opener keeps the campaign shape of one sentence per line. The case for flowing is a title short enough to set on one line: broken per sentence, "The whole register. Open." put the round "O" under the flat stem of the "T" above it, which reads as a ragged left edge even though both lines start at exactly the same x (measured at 0.00px across five widths in both catalogs -- the misalignment is optical, not geometric, and no negative margin can fix it in both languages because the two catalogs start on different glyphs). Flowed, there is no second line to disagree.

The cap widens with the flow, and like the centred anchor's it is measured rather than chosen. At `display-lg` the directory title is 866.8px in English and 903.5px in German, so the anchor tier's own `max-w-4xl` (896px) clears English and wraps German with "Offen." alone on a second line. `max-w-5xl` (1024px) -- the step the centred anchor already settled on -- holds both inside a band 1104px wide. A title too long for one line still wraps: the cap is a ceiling, not a promise, so check both catalogs when the copy changes.

A major may take the pill too, through `eyebrowVariant="pill"` (2026-09-14). It is opt in and `line` stays the default, so every existing major keeps the bare caps line: a left aligned eyebrow has a left edge to sit on, which is what makes the bare line work there. The case it exists for is a page whose opener wears the pill and which would otherwise answer it with a second eyebrow shape further down -- the expert network's vetting band, the only call site. It renders the same `EYEBROW_PILL`, so the site still has one pill; a page mixing the two shapes for no reason a reader can infer is the thing to challenge in review.

The reference also set its heading as the two tone `emphasis` shape. The pricing opener deliberately does not take that half: "Fixed price. No surprises." is already the landing page's emphasis heading (`marketing.landing.packages.title`), and a reader crossing to `/pricing` would meet what looks like the same block twice. `emphasis` also absorbs the lead into the heading's muted sentences, and this page's lead carries the 8.1% VAT note, which has to stay a sentence of its own. `emphasis` remains majors only.

### Hero object

The hero is the statement, one lead, one control and one utility line, on the page ground (white in light, jet in dark) behind the ruled field, so the header never inverts on it; the headline is a `Statement` in `layout="flow"`. The hero's own controls take the `xl` button size and an `h-11` input (`CompanyLookupField size="hero"`); nothing else on the site uses that size.

Under it, outside the ruled field, sits the hero object: `HeroResearch` (`src/features/marketing/ui/hero-research.tsx`) is a still of the client area's first screen, drawn from that screen's own `Card`, `Field`, `Input` and `ProgressList` and its own `research.lookup.*` strings, so the page shows the product rather than describing it and the picture cannot drift from the screen it pictures. The whole block is `inert` and carries one `role="img"` with an `aria-label` saying what it is a picture of, so nothing inside it takes focus, answers a click or reaches the accessibility tree: a visitor must never mistake it for the live form, and the hero's real lookup field stays the only control on the page.

`HeroBenchmark`, an example benchmark of a fictional Muster AG on invented figures, held the slot before and was removed on 2026-09-10 (owner decision): it re-composed the dashboard's card into a two card crop and carried its own `marketing.landing.example.*` labels that could drift from `kpi_definitions`. A hero object shows a screen that exists, drawn from that screen's own components and strings.

### Tier map

The tier of every section that exists today. A new section joins this table.

Pricing and the expert network are the two pages with no closing call to action (owner decisions of 2026-09-14). Every other page ends on the jet anchor, which is what gives a page the same weight at its close that it opened with. Pricing is the page where the action is the content: four cards each carrying their own call to action, above a comparison table and an FAQ that exist to answer the question those cards raise. A fifth ask under the FAQ repeated on one page what the cards already offer four times.

The expert network is a different case and worth naming as one. It has no content that carries the ask the way the package cards do, so it is the one marketing page that ends without one anywhere below the hero: a reader who finishes the vetting ladder has the header navigation and the hero's own register link, which they passed four sections earlier. That is a composition decision rather than an argument the page makes, and the `closing.*` keys stay in both catalogs so the band is one element to restore. A third page dropping its closing anchor should be treated as the rule changing rather than as a third exception.

| Page | Sections in order |
|---|---|
| Landing | anchor hero on the page ground, centred, with the hero object under it · minor worked figure beside the cost iceberg (the walkthrough photograph until 2026-09-12) · **major steps** · major packages · major experts · major trust, centred rather than split · minor FAQ · anchor jet closing |
| How it works | anchor opener · **major steps** · major split of labour · minor timing · anchor jet closing |
| Expert network | anchor opener, centred · major profiles, openerless · major the standard, bracketed · major vetting, pill eyebrow (no closing) |
| Directory | anchor opener, left, pill eyebrow and flowed heading, with the figure ledger under it · major coverage · major the register · anchor jet closing |
| Pricing | anchor opener, centred · **major packages, openerless** · minor compare · minor FAQ (no closing) |
| About | anchor opener · major story · **major ruled campaign grid** · minor how we work · anchor jet closing |
| Contact | anchor opener · major facts and form · anchor jet closing |

## Motion

Overlays and toasts use `tw-animate-css` fades and slides, 150 to 200ms. A global `prefers-reduced-motion: reduce` rule clamps every animation and transition to 1ms (not zero, so Radix exit animations still complete and overlays unmount). Do not add motion that carries meaning on its own.

## Component inventory

| Group | Components | Rules |
|---|---|---|
| Forms | `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldSet`, `FieldLegend`, `Input`, `InputOTP` (`InputOTPGroup`, `InputOTPSlot`), `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Label` | React Hook Form plus Zod. Errors render in `FieldError` directly under the field; set `data-invalid` on `Field`, `aria-invalid` and `aria-describedby` on the control. Layout with `FieldGroup`, never `space-y-*`. `InputOTP` is the six digit code entry (spec 0005): six slots, `inputMode="numeric"`, `autoComplete="one-time-code"`, labelled through `id`. |
| Data | `Table` (with `density="compact"`), `Card`, `Badge`, `Tabs`, `Pagination`, `Skeleton` | Only table cells may truncate, and only with the full text in a `Tooltip` (hover and focus). Badge variants: `default`, `secondary`, `outline`, `success`, `warning`, `info`, `destructive`, `critical`, `high`, `medium`, `low`. |
| Overlays | `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Tooltip`, `Sidebar` | Every dialog and sheet has a title (`sr-only` if hidden). Focus is trapped and returned by Radix. Items live inside their group. |
| Feedback | `Alert` (`default`, `info`, `success`, `warning`, `destructive`), `Progress`, `Separator`, `Breadcrumb`, `Accordion`, `Toaster` (Sonner) | One `Toaster` in the locale layout; call `toast()` from `sonner`. Alerts carry an icon and a title. `Accordion` (shadcn) is the FAQ pattern: one item open by default, the trigger is a real button. |
| Charts | `ChartContainer`, `ChartTooltip`, `ChartLegend` (Recharts) | Client components only. Map series to `var(--chart-n)` in the config. Series colors pass the 3:1 token gate; tooltip and legend text are checked by eye in the gallery. |
| Quartile band | `QuartileBand` (`src/components/ui/quartile-band.tsx`) | Server component: an SVG band from p25 to p75 (`chart-3`), a median tick (`chart-2`) and the company marker (`chart-1`); the drawing is decorative and an `sr-only` sentence carries the meaning. Spec 0008. |
| Cost iceberg | `CostIceberg` (`src/components/cost-iceberg.tsx`) | Server component: the visible share of an accident's cost as a solid tip above the waterline and the hidden share as a hairline outline below it, in `currentColor` only; the waterline is the `border` hairline, running under the two label columns as well as the drawing, and the halves are cut from one silhouette at the height the two `share` props demand (`splitIceberg`, pure), so a 20 and 80 drawing holds four times the area under the line as above it. The figures on it are catalogue strings, never formatted numbers. The whole figure is decorative (`aria-hidden`, labels included) and the `sr-only` `label` carries the meaning, the `QuartileBand` shape. Labels sit at 400 so the tip never outweighs the body copy. The client review of 2026-09-11, win 9 (spec 0009). |
| Disclosure | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` (shadcn) | Closed by default; the trigger is a real button with the focus ring; the content may be server rendered children. Spec 0008. |
| Shared | `PageHeader`, `PageStack`, `EmptyState`, `ErrorState`, `SkipLink`, `ThemeToggle`, `ThemeSubmenu`, `LocaleSwitcher`, `MarketingHeader` | `src/components/`, named exports, one line JSDoc. `ThemeToggle` is a segmented pill of icon radios (`rounded-full border bg-background p-0.5`, 28px segments, `bg-accent` plus `shadow-xs` on the active one); `LocaleSwitcher` is a dropdown with a matching pill shaped trigger (`h-[34px] rounded-full border`, the height of the theme pill) showing the current language. Where both appear, place them side by side with `gap-2`; the marketing header carries the language switch alone (the theme control sits in the footer). |
| Brand | `BrandMark`, `Logo`, `Statement`, `SquareStop`, `Signature` | `src/components/brand/`, see `## Brand`. |
| Shell | `AreaShell` (server), `AppSidebar` (client), `LocaleMenuItems`, `AreaError`, `PageSkeleton`, `nav.ts` | `src/components/shell/`. Add a navigation entry by appending to `AREA_NAV` in `nav.ts` and its `nav.<area>.<key>` messages. |
| Marketing | `MarketingFooter`, `CompanyLookupField`, `SectionHeader`, `HeroResearch`, `StepsSection`, `StepsRail`, `StepVisual`, `PackageCard`, `PackagesGrid`, `RegisterDirectory`, `ExpertProfiles`, `ExpertProfilesFilter`, `Faq`, `TrustSection`, `ClosingCta`, `EnquiryForm`, `EnquiryConfirmation`, `JsonLd` | `src/features/marketing/ui/` (spec 0009). Sections sit in `max-w-6xl`, a hairline grid (`gap-px border bg-border`) for the packages (the steps became a column of passages divided by a single rule on 2026-09-10, see `### The steps rail`), the inverse block for the closing call to action and the landing trust band (the landing hero sits on the page ground). `TrustSection` frames its panel grid with the closed `border` hairline the steps and packages sections use, with four short corner brackets over it at `border-foreground/40`: framed like every other block, still marked out at its corners. `CornerBrackets` is that device as a primitive, shared by the trust band, the package card (which fades them in on hover) and the expert network's standard band (2026-09-14); the caller owns a `relative` box carrying the `border` they sit over, and the offsets live in the one file so the three cannot drift. The gallery's Marketing section shows the three `SectionHeader` tiers, the client area still, the cost iceberg, the register directory, the package card, the FAQ and the enquiry form empty and in its error state. `SectionHeader` renders the anchor, major and minor openers from a `tier` prop, see `## Marketing section vocabulary`. |

Icons: lucide, `size-4` inline (components size them), decorative icons `aria-hidden="true"`, icon only buttons carry `aria-label`. Icons inside a `Button` use `data-icon="inline-start"` or `inline-end`.

## Page anatomy (signed in)

```
<AreaShell area="…">          (layout: sidebar, top bar, #main, skip link)
  <PageStack>
    <PageHeader title description? breadcrumb? actions? />
    …sections (gap-8), each with an h2…
  </PageStack>
</AreaShell>
```

Beside every area `layout.tsx`: `loading.tsx` renders `PageSkeleton` shaped like the overview, `error.tsx` renders `AreaError` (Sentry capture, `ErrorState` with the event id or digest, retry). Both render inside the layout, so the sidebar stays.

## State patterns

- **Loading**: `Skeleton` blocks in the shape of the content, container marked `aria-busy`. Never a blank area.
- **Empty**: `EmptyState` with an icon, a title, one sentence and at most one action. Used by every empty list or placeholder. The title is a paragraph under the page's own `h1`; pass `titleAs="h1"` when the state is the whole page (the forbidden page).
- **Error**: `ErrorState` with a message, a retry button and a reference id. Report to Sentry before showing it.
- **Success or progress feedback**: a toast for transient outcomes, an `Alert` for anything the user must still see after a reload.
- **Validation**: inline under the field, `role="alert"` on the error, control marked `aria-invalid`.

## Long text rule

Nothing truncates except table cells. A truncated cell wraps its text in a `Tooltip` whose trigger is focusable, so hover and keyboard focus both reveal the full text. Everywhere else, wrap: buttons and navigation labels are short by design, prose caps at `max-w-prose`. The gallery test asserts that sampled navigation items and buttons have no horizontal overflow.

## Interface compliance

_Added 2026-09-09, during the marketing UX pass. The [Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines) (the `web-design-guidelines` skill, which fetches them fresh on every run) are a named gate on this design system, sitting under everything above: this file decides what a surface looks like and which vocabulary it uses, the guidelines decide whether the mechanics underneath are sound. Where the two disagree, this file wins and the disagreement is recorded below._

Run the skill against the files you changed before opening a PR, the same way `pnpm budget` gates first load JavaScript:

```
/web-design-guidelines src/features/marketing/ui/*.tsx
```

The guidelines are largely already met, and the parts we meet are load bearing, so do not undo them: `[data-numeric]` and `.tabular-nums` in `globals.css` carry `font-variant-numeric` for every figure; the `prefers-reduced-motion` block clamps to 1ms rather than zero so Radix exit animations still fire; `[data-marketing] :is(:target, input, select, textarea, fieldset)` clears the sticky header so a fragment target and the field React Hook Form focuses on an invalid submit both stay in view; `RegisterDirectory` pages at fifty rows rather than mapping 1,929 and defers its grouped count until mount. An `outline-none` on a `tabIndex={-1}` skip link landing (`#main`, the forbidden page, the auth page) is correct and is not a finding.

### Additive only, on a marketing branch

_Adopted 2026-09-09 during the marketing UX pass, recorded here 2026-09-11._

A branch polishing the public pages grows the design system **additively**. Allowed: a **new** token in `src/app/globals.css`, a **new** primitive, a **new** section on the ops only `/admin/design` gallery, a **new** section in this file.

Not allowed: changing the **value** of an existing token, or an existing component's default styling. Those restyle `/app`, `/expert` and `/admin` — areas nobody is looking at while working on a marketing page. If a value genuinely must change, that is its own change on its own branch, reviewed across all four areas.

Check before every PR; additive shows as pure `+` lines:

```
git diff main -- src/app/globals.css docs/design.md src/components/
```

`src/components/` is in the command because the token files alone do not catch the second half of the rule: a shared primitive restyled in place changes `/app`, `/expert` and `/admin` without touching a token. The weight cap of 2026-09-10 is the worked example — it landed as four `-` lines under `src/components/` (`app-sidebar`, `page-header`, `signature`, `logo`) and none in `globals.css`.

Any `-` line touching an existing token or a primitive's default styling is the thing to challenge. A deliberate exception answers with the decision behind it and the gate that holds it — the weight cap answers with the owner decision and `tests/font-weight.test.ts`.

### The four fixes

Four gaps were real when the gate was adopted. All four are additive, so all four sit inside the rule above.

| Fix | Where | Why |
|---|---|---|
| `viewport` export carrying `themeColor` | `src/app/[locale]/layout.tsx` | Two entries under `prefers-color-scheme`, matching the light page ground and the dark one. Without it the mobile browser chrome does not follow the jet ground, which breaks the full bleed of a jet opener and the closing call to action. |
| `text-wrap: balance` on section headings | `SectionHeader`, all three tiers | A display size heading over two or three words per line strands a widow. `Statement` already balances; the tier headings did not. |
| `touch-action: manipulation` and an intentional `-webkit-tap-highlight-color` | `globals.css`, on the interactive elements | Removes the double tap zoom delay on iOS and stops the default blue flash landing on our black and white surfaces. |
| `translate="no"` on the wordmark and identifiers | `Logo`, `font-mono` identifiers | "SME24" survives an auto translated page intact. |

### Deliberate exceptions

- **Title Case for headings and buttons.** The guidelines ask for Chicago style Title Case; we use sentence case in both languages. German does not take title case at all, so following the rule would either break the German catalog or split the two catalogs' voice, and the campaign statements ("Senior experts. No slides. Just results.") are written as sentences by the brand guidelines. Sentence case stays.
- **`autocomplete="off"` on non-auth fields.** The enquiry form deliberately keeps real autocomplete tokens (`organization`, `name`, `email`, `tel`) because a returning enquirer filling six fields by hand is the worse outcome. The honeypot keeps `autocomplete="off"`, which is what that rule is actually protecting.

## Do's and Don'ts

- Do compose `PageHeader` + `PageStack`; don't render a second `h1`.
- Do use `Badge` for status; don't color plain text to mean status.
- Do use `Separator`, `Skeleton`, `Alert`, `EmptyState`; don't rebuild them with styled `div`s.
- Do use `flex` with `gap-*`; don't use `space-x-*` or `space-y-*`.
- Do keep `className` for layout; don't override a component's colors or type.
- Do add a gallery section with every new primitive; don't ship one axe never sees.
- Do write campaign copy as short sentences and let `Statement` set the square stops; don't type the square yourself or end a statement with an exclamation mark.
- Do build marketing sections from `CampaignPiece`, `CampaignFrame`, `CampaignGrid` and `CampaignWall` with real cut out photography; don't ship a `placeholder` frame.
- Do use `BrandMark` and `Logo`; don't paste the path elsewhere, recolor the mark or set it on imagery.
