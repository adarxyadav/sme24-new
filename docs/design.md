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
3. No accent hue. The brand is black and white: `primary` is jet on white (white on jet in the dark theme) and marks primary actions, links (always underlined) and focus. Status and severity colors are the only hues, and they always sit next to a label or an icon. Color is never the only carrier of meaning.
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
| Ruled | `RuledField` | The one section per page that turns the argument (the steps on the landing page, the vetting ladder on the expert network). At most one per page, never adjacent to another non white ground. |
| Jet | `className="dark bg-background text-foreground"` | The page opener when it is a hero, and the closing call to action. Structural bookends, never mid page. A jet opener also carries `hero` on its `RuledField` and its route joins `DARK_HERO_ROUTES` so the header holds its inversion. |

### Openers

The opener follows from the tier, so there is nothing extra to decide per section.

| Tier | Opener |
|---|---|
| Anchor | Stacked and left aligned: eyebrow, `Statement`, lead paragraph, `gap-6`. |
| Major | Split: eyebrow and `Statement` in the left column, the lead in the right (`lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]`). The lead is optional; without one the heading spans. |
| Minor | Inline, no eyebrow: heading and lead on one row (`md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]`), wrapping to two rows below `md`. |

`SectionHeader` in `src/features/marketing/ui/` renders all three from a `tier` prop; a page composes it rather than hand rolling the markup. A section that is deliberately different (the campaign wall, the packages grid) may still open with its own markup, but it picks one of the three shapes.

One band is deliberately openerless: the landing page's worked figure, the passage between the hero and the steps (2026-09-10). It is one sentence with the figure set inside it and nothing else -- no opener, no footnote and no link -- and it carries an `sr-only` `h2` so the landmark is still named. A minor opener above one sentence re-created the stack -- heading, lead, figure, footnote -- that three passes had already been spent removing, on a band a reader crosses rather than stops at. A section may drop its opener only when it is a single sentence long; anything with two blocks takes one of the three shapes above.

### The steps rail

`StepsSection` (both the landing page and how it works) sets its steps as full width passages down one column with a sticky rail beside them, rather than as the four across grid it was until 2026-09-10. The reason is that the content is a sequence: four equal cells side by side ask to be compared, which is what the packages grid wants and what a process does not, and at `text-xl` in a cell the step titles were captions under a number rather than the section's argument. The titles now take `text-2xl md:text-display-sm`, the number moves into its own column so the four titles share a left edge, and a single hairline runs between steps instead of a closed box around each.

The rail (`StepsRail`, the section's only client component) names the four steps and highlights the one the reader is level with. It is a position indicator for content the server already rendered in full, so it is `aria-hidden` -- it duplicates the panel headings, nothing in it is focusable, and a screen reader reads the panels in order without it -- while its `nav` keeps a name so the landmark is not anonymous. Below `lg` it is absent: a sticky index needs a viewport tall enough to hold both it and the panel it indexes, and on a phone the panels already arrive one per screen.

Two mechanics are load bearing. The field carries `stickyChildren`, which swaps `RuledField`'s `overflow-hidden` for `overflow-clip`: `hidden` gives an element a scrolling mechanism and a sticky descendant anchors to that nearest scrolling ancestor instead of the viewport, so the rail would never move, while `clip` is deliberately excluded from that list and clips the rules identically (MDN, `position`). And the highlight is measured from the panel tops against a line at 40% of the viewport, with the `IntersectionObserver` only as the trigger and a rAF coalesced `scroll` listener beside it: with four short panels several are on screen at once, so "which one is intersecting" has no single answer, and a scroll between two thresholds fires no observer callback at all.

### Hero object

The hero is the statement, one lead, one control and one utility line, on the page ground (white in light, jet in dark) behind the ruled field, so the header never inverts on it; the headline is a `Statement` in `layout="flow"`. The hero's own controls take the `xl` button size and an `h-11` input (`CompanyLookupField size="hero"`); nothing else on the site uses that size.

Under it, outside the ruled field, sits the hero object: `HeroResearch` (`src/features/marketing/ui/hero-research.tsx`) is a still of the client area's first screen, drawn from that screen's own `Card`, `Field`, `Input` and `ProgressList` and its own `research.lookup.*` strings, so the page shows the product rather than describing it and the picture cannot drift from the screen it pictures. The whole block is `inert` and carries one `role="img"` with an `aria-label` saying what it is a picture of, so nothing inside it takes focus, answers a click or reaches the accessibility tree: a visitor must never mistake it for the live form, and the hero's real lookup field stays the only control on the page.

`HeroBenchmark`, an example benchmark of a fictional Muster AG on invented figures, held the slot before and was removed on 2026-09-10 (owner decision): it re-composed the dashboard's card into a two card crop and carried its own `marketing.landing.example.*` labels that could drift from `kpi_definitions`. A hero object shows a screen that exists, drawn from that screen's own components and strings.

### Tier map

The tier of every section that exists today. A new section joins this table.

| Page | Sections in order |
|---|---|
| Landing | anchor hero on the page ground, centred, with the hero object under it · minor proof points · **major ruled steps** · major packages · minor campaign wall · major trust · anchor jet closing |
| How it works | anchor opener · **major ruled steps** · major split of labour · minor timing · anchor jet closing |
| Expert network | anchor opener · major the standard · **major ruled vetting** · minor matching and coverage · anchor jet closing |
| Pricing | anchor opener · **major packages** · minor included · minor FAQ · anchor jet closing |
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
| Disclosure | `Collapsible`, `CollapsibleTrigger`, `CollapsibleContent` (shadcn) | Closed by default; the trigger is a real button with the focus ring; the content may be server rendered children. Spec 0008. |
| Shared | `PageHeader`, `PageStack`, `EmptyState`, `ErrorState`, `SkipLink`, `ThemeToggle`, `ThemeSubmenu`, `LocaleSwitcher`, `MarketingHeader` | `src/components/`, named exports, one line JSDoc. `ThemeToggle` is a segmented pill of icon radios (`rounded-full border bg-background p-0.5`, 28px segments, `bg-accent` plus `shadow-xs` on the active one); `LocaleSwitcher` is a dropdown with a matching pill shaped trigger (`h-[34px] rounded-full border`, the height of the theme pill) showing the current language. Where both appear, place them side by side with `gap-2`; the marketing header carries the language switch alone (the theme control sits in the footer). |
| Brand | `BrandMark`, `Logo`, `Statement`, `SquareStop`, `Signature` | `src/components/brand/`, see `## Brand`. |
| Shell | `AreaShell` (server), `AppSidebar` (client), `LocaleMenuItems`, `AreaError`, `PageSkeleton`, `nav.ts` | `src/components/shell/`. Add a navigation entry by appending to `AREA_NAV` in `nav.ts` and its `nav.<area>.<key>` messages. |
| Marketing | `MarketingFooter`, `CompanyLookupField`, `SectionHeader`, `HeroResearch`, `StepsSection`, `StepsRail`, `PackageCard`, `PackagesGrid`, `RegisterDirectory`, `Faq`, `TrustSection`, `ClosingCta`, `EnquiryForm`, `EnquiryConfirmation`, `JsonLd` | `src/features/marketing/ui/` (spec 0009). Sections sit in `max-w-6xl`, a hairline grid (`gap-px border bg-border`) for the packages (the steps became a column of passages divided by a single rule on 2026-09-10, see `### The steps rail`), the inverse block for the closing call to action and the landing trust band (the landing hero sits on the page ground). `TrustSection` frames its panel grid with the closed `border` hairline the steps and packages sections use, with four short corner brackets over it at `border-foreground/40`: framed like every other block, still marked out at its corners. The gallery's Marketing section shows the three `SectionHeader` tiers, the client area still, the register directory, the package card, the FAQ and the enquiry form empty and in its error state. `SectionHeader` renders the anchor, major and minor openers from a `tier` prop, see `## Marketing section vocabulary`. |

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

### The four fixes

Four gaps were real when the gate was adopted. All four are additive, so all four sit inside a marketing branch's design system rule.

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
