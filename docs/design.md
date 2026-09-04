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
| Lockup | `Logo` (`variant`, `size="sm" \| "md" \| "lg"`, `descriptor`) | Mark plus the wordmark "SME24" in Geist 800 with display tracking; `descriptor` adds "EHS CONSULTING" tracked at `tracking-lockup`. Primary lockup is bare, alternate is the badge. Used in the marketing header and sign in (`size="md"`); the sidebar shows the bare mark beside the name. |
| Statement | `Statement` (`text`, `as`) | Campaign copy: each sentence on its own line, closed by the square stop (`SquareStop`, a solid square on the baseline with an `sr-only` period). Pair with `text-display-*` or a headline size. "Senior experts. No slides. Just results." |
| Signature | `Signature` | The badge beside "SME24. Einfach. Anders." / "SME24. Just. Different." (`brand.signature`). Closes marketing pages and campaign blocks. |
| Inverse block | `className="dark bg-background text-foreground"` on a section | The jet black ground in both themes (the brand's 30% jet). The `.dark` token block applies to the subtree, so every component inside keeps working. The landing hero is one. |
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
| Display · 800 · −3% | `text-display-lg` (72px), `text-display` (56px), `text-display-sm` (40px); weight and tracking are built into the size. Marketing statements and campaign blocks. |
| Headline · 700 · −2% (`h1`, rendered by `PageHeader`) | `text-2xl font-bold tracking-headline` |
| Subhead · 600 (`h2`) | `text-lg font-semibold` |
| Card title | `text-base font-semibold` |
| Body · 400 | `text-sm` (14px) |
| Secondary | `text-xs text-muted-foreground` |
| Caption · 500 · caps | `eyebrow text-muted-foreground` |
| Identifiers, code | `font-mono text-xs` |
| Numbers in tables and KPI tiles | add `tabular-nums` (or `data-numeric`) so figures align |

Prose blocks cap at `max-w-prose`. Exactly one `h1` per page. Heading levels never skip.

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

## Motion

Overlays and toasts use `tw-animate-css` fades and slides, 150 to 200ms. A global `prefers-reduced-motion: reduce` rule clamps every animation and transition to 1ms (not zero, so Radix exit animations still complete and overlays unmount). Do not add motion that carries meaning on its own.

## Component inventory

| Group | Components | Rules |
|---|---|---|
| Forms | `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldSet`, `FieldLegend`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Label` | React Hook Form plus Zod. Errors render in `FieldError` directly under the field; set `data-invalid` on `Field`, `aria-invalid` and `aria-describedby` on the control. Layout with `FieldGroup`, never `space-y-*`. |
| Data | `Table` (with `density="compact"`), `Card`, `Badge`, `Tabs`, `Pagination`, `Skeleton` | Only table cells may truncate, and only with the full text in a `Tooltip` (hover and focus). Badge variants: `default`, `secondary`, `outline`, `success`, `warning`, `info`, `destructive`, `critical`, `high`, `medium`, `low`. |
| Overlays | `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Tooltip`, `Sidebar` | Every dialog and sheet has a title (`sr-only` if hidden). Focus is trapped and returned by Radix. Items live inside their group. |
| Feedback | `Alert` (`default`, `info`, `success`, `warning`, `destructive`), `Progress`, `Separator`, `Breadcrumb`, `Toaster` (Sonner) | One `Toaster` in the locale layout; call `toast()` from `sonner`. Alerts carry an icon and a title. |
| Charts | `ChartContainer`, `ChartTooltip`, `ChartLegend` (Recharts) | Client components only. Map series to `var(--chart-n)` in the config. Series colors pass the 3:1 token gate; tooltip and legend text are checked by eye in the gallery. |
| Shared | `PageHeader`, `PageStack`, `EmptyState`, `ErrorState`, `SkipLink`, `ThemeToggle`, `ThemeSubmenu`, `MarketingHeader` | `src/components/`, named exports, one line JSDoc. |
| Brand | `BrandMark`, `Logo`, `Statement`, `SquareStop`, `Signature` | `src/components/brand/`, see `## Brand`. |
| Shell | `AreaShell` (server), `AppSidebar` (client), `LocaleMenuItems`, `AreaError`, `PageSkeleton`, `nav.ts` | `src/components/shell/`. Add a navigation entry by appending to `AREA_NAV` in `nav.ts` and its `nav.<area>.<key>` messages. |

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
