# SME24 design reference

_The file every page is built against. Spec: [0003 Design system and UI foundation](specs/0003-design-system/index.md). Token values live in `src/app/globals.css`; this file explains how to use them, it never repeats them._

- **source**: spec 0003, direction "Swiss precision"
- **character**: calm, precise, trustworthy. A serious B2B product for people who carry legal responsibility for safety. Near monochrome surfaces, hairline dividers, flat cards, one accent, a strong type hierarchy. Nothing decorative that does not carry information.
- **tokens**: `src/app/globals.css` (`:root` light, `.dark` dark, exposed to Tailwind through `@theme inline`)
- **components**: `src/components/ui/` (shadcn, `radix-nova` preset), `src/components/` (shared primitives), `src/components/shell/` (signed in frame), `src/components/gallery/` (the gallery sections)
- **gallery**: `/admin/design` (ops only). A new primitive lands with its gallery section, or it escapes the axe scan.

## Build mandate

1. Compose from the inventory below. Do not invent a new control, layout or color when one exists here. If you need one, add it to `src/components/` with a gallery section and a line in this file.
2. Every visual value comes from a token: colors through `bg-*`, `text-*`, `border-*` utilities, spacing from Tailwind's default 4px scale, radius from the `rounded-*` scale. No raw `oklch()`, hex or pixel values in components.
3. One accent. The brand teal (`primary`) marks primary actions, links, active navigation and focus. Status and severity colors are the only other hues, and they always sit next to a label or an icon. Color is never the only carrier of meaning.
4. Every user facing string goes through next-intl (`messages/de.json` is the authoritative key set, `messages/en.json` mirrors it; `tests/messages.test.ts` fails when they drift).
5. WCAG 2.2 AA is the floor: visible focus, keyboard operable, announced states. The contrast gate (`tests/contrast.test.ts`) runs on every commit; axe runs on the gallery in Playwright.

## Type

Fonts: Geist Sans for text and headings, Geist Mono for identifiers, run ids and code. Both are self hosted through `next/font` in `src/app/[locale]/layout.tsx`; the variables sit on `html`, so `font-sans` applies everywhere.

| Use | Classes |
|---|---|
| Marketing display | `text-display-lg`, `text-display`, `text-display-sm` with `font-semibold` (only under `(marketing)`) |
| Page title (`h1`, rendered by `PageHeader`) | `text-2xl font-semibold tracking-tight` |
| Section title (`h2`) | `text-lg font-semibold` |
| Card title | `text-base font-medium` |
| Body | `text-sm` (14px) |
| Secondary, captions | `text-xs text-muted-foreground` |
| Identifiers, code | `font-mono text-xs` |
| Numbers in tables and KPI tiles | add `tabular-nums` (or `data-numeric`) so figures align |

Prose blocks cap at `max-w-prose`. Exactly one `h1` per page. Heading levels never skip.

## Color

Semantic tokens only, named like shadcn so the installed components keep working. Every name below exists in `globals.css` in both themes.

| Group | Tokens | Use |
|---|---|---|
| Ground | `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground` | Page and surfaces. Cards are flat: border, no shadow. |
| Subtle | `muted`, `muted-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground` | Subtle fills, secondary text, hover fills. Secondary text still passes 4.5:1. |
| Lines | `border`, `input`, `ring` | `border` is the decorative hairline. `input` outlines a control and `ring` is the focus ring; both reach 3:1 on every ground. |
| Brand | `primary`, `primary-foreground` | Primary buttons, links, active navigation. |
| Status | `success`, `warning`, `info`, `destructive`, each with `-foreground` and `-subtle` | Solid fill with `-foreground` text; `-subtle` tint with the fill color as text (`bg-success-subtle text-success`). |
| Severity | `severity-critical`, `severity-high`, `severity-medium`, `severity-low`, each with `-foreground` and `-subtle` | Gap findings and benchmark levels, always with the level label. |
| Charts | `chart-1` to `chart-5` | Series colors in order: teal, slate blue, amber, plum, gray. Adjacent series never pair red with green. |
| Sidebar | `sidebar`, `sidebar-foreground`, `sidebar-primary`, `sidebar-primary-foreground`, `sidebar-accent`, `sidebar-accent-foreground`, `sidebar-border`, `sidebar-ring` | The signed in navigation. |

**Contrast rule.** `src/lib/design-tokens.ts` lists every guaranteed pair. Text pairs must reach 4.5:1, `input` and `ring` on every ground 3:1. No text token is treated as large text. Translucent values are composited over their ground before measuring, `color-mix` is evaluated from the two colors. If you change a value, keep the hue and let the test decide. The gallery shows the live ratio next to every swatch.

**Theme.** `next-themes` writes `light` or `dark` on `html`; the default follows the system. `:root` sets `color-scheme: light` and `.dark` sets `color-scheme: dark`, so native controls follow. The preference lives in `localStorage.theme`, per browser by design. Nothing reads or writes theme state except through `next-themes` (`ThemeToggle`, `ThemeSubmenu`).

## Spacing, layout and radius

- Tailwind's default 4px scale, no custom steps.
- Page gutter `px-6` (`px-4` under 640px), sections `gap-8`, inside cards `p-6`, between form fields `gap-4`. `PageStack` applies the page values.
- Widths: signed in content `max-w-7xl` (in `PageStack`), marketing `max-w-6xl`, forms `max-w-2xl`.
- Control heights: the preset's 32px default. Marketing calls to action use `size="lg"`.
- Radius `0.375rem` (`--radius`), derived scale `rounded-sm` to `rounded-4xl` from the preset.
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
| Charts | `ChartContainer`, `ChartTooltip`, `ChartLegend` (Recharts) | Client components only. Map series to `var(--chart-n)` in the config. Charts are checked by eye in the gallery. |
| Shared | `PageHeader`, `PageStack`, `EmptyState`, `ErrorState`, `SkipLink`, `ThemeToggle`, `ThemeSubmenu`, `MarketingHeader`, `Wordmark` | `src/components/`, named exports, one line JSDoc. |
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
- **Empty**: `EmptyState` with an icon, a title, one sentence and at most one action. Used by every empty list or placeholder.
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
