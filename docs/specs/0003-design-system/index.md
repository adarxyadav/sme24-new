# 0003. Design system and UI foundation

**Date**: 2026-09-04
**Status**: Accepted

## Summary

SME24 gets one visual language for the marketing site and the three signed in areas: a calm "Swiss precision" look built from design tokens (named CSS variables for color, type, spacing and radius) on top of the shadcn/ui components you already own, with a deep teal green as the single brand color. Light and dark mode both ship, following the system setting with a user toggle. The feature installs and themes the full base set of components, a left sidebar shell for the signed in areas, shared page primitives (page header, empty state, error state, skeleton loading, toasts), chart styling on Recharts, and an ops only gallery page where every primitive is checked for keyboard, focus, screen reader and contrast at WCAG 2.2 AA (the accessibility standard the product commits to). It ends with `docs/design.md`, the file every later page is built against.

## Requirements

**User stories**:
- As a client user, I want every page of SME24 to look and behave like one product so that a regulated company trusts it with its safety data.
- As an EHS expert or ops person, I want a working shell with clear navigation, readable tables and a dark mode so that long working sessions are comfortable.
- As a developer building a later feature, I want tokens, primitives and a written design reference so that I compose pages instead of inventing styles.
- As a user relying on a keyboard or screen reader, I want every control reachable and announced so that the product meets WCAG 2.2 AA.

**Acceptance criteria** (the contract, each criterion is IDed and independently checkable):
- **AC-1**: `src/app/globals.css` defines the token set in `## Feature design` (brand primary, neutrals, status, severity, chart and sidebar tokens) for both light and dark, `pnpm build` passes with the unresolvable `shadcn/tailwind.css` import removed, and a Vitest test reads that file, computes the contrast of every pair listed in `src/lib/design-tokens.ts` and fails below 4.5:1, except the `--border` and `--ring` pairs which must reach 3:1 (the WCAG tier for non text elements).
- **AC-2**: Body text renders in Geist Sans (a Playwright assertion on the gallery reads the computed font family of `body` and expects it to start with `Geist`), code and identifiers in Geist Mono, numeric table cells and KPI figures use tabular figures, and the type scale in `## Feature design` (including the marketing display sizes) is available as utilities.
- **AC-3**: The theme follows the system setting by default, a user can pick system, light or dark from the signed in user menu and from the marketing header, the choice survives a reload in the same browser, the first paint shows the chosen theme with no flash, and the `color-scheme` of the document follows so native controls match.
- **AC-4**: `/app`, `/expert` and `/admin` render the same sidebar shell with area specific navigation, the sidebar collapses to icons on desktop and becomes a sheet (a slide in panel) at 375px width, the user menu holds locale, theme and sign out, and a skip link jumps to `main`; all of it operable by keyboard alone.
- **AC-5**: Every existing signed in page uses the `PageHeader` primitive (title, optional description, optional breadcrumb, right aligned actions) above a content stack with the shared max width, and the marketing layout has a responsive header (sheet navigation on mobile) built from the same tokens with the display type scale.
- **AC-6**: The full base set in `## Feature design` is installed in `src/components/ui/`, themed to the tokens, and `/admin/design` (ops only; client and expert users get the forbidden page as the proxy already enforces) renders every primitive in every state, in the compact table density too.
- **AC-7**: Each signed in area has a `loading.tsx` of skeletons shaped like its overview page and an `error.tsx` that renders the shared `ErrorState` (message, retry, Sentry event id) after reporting to Sentry; the shared `EmptyState` (icon, title, text, one action) is used by every existing empty list or placeholder.
- **AC-8**: One Sonner toaster is mounted in the root layout, themed to the tokens, announced to screen readers, and a form built on the shadcn Form components shows Zod field errors inline under the field.
- **AC-9**: shadcn Chart (Recharts) is installed, its colors come from the chart tokens, and the gallery shows a bar chart and a line chart with a themed tooltip and legend that read correctly in both themes (checked by eye in the gallery, since axe skips SVG text).
- **AC-10**: axe in Playwright reports no WCAG 2.2 AA violations on `/admin/design` in light and dark, in `de` and `en`; every interactive primitive shows a visible focus ring; `prefers-reduced-motion` disables transitions and animations; sampled navigation items and buttons in the gallery have no horizontal overflow (`scrollWidth` at most `clientWidth`), and a truncated table cell shows a `Tooltip` with the full text on hover and on focus.
- **AC-11**: `docs/design.md` documents the direction, type, color (with token names and the contrast rule), spacing, radius, motion, the component inventory with usage rules, the state patterns and the long text rule, and every token it names exists in `globals.css`.
- **AC-12**: Every user facing string added by this feature (shell, menus, gallery, states, toasts) goes through next-intl with entries in `messages/de.json` and `messages/en.json`.

## Decision

**Chosen option**: Option 2: Token based system on shadcn/ui with a custom "Swiss precision" direction

Keep shadcn/ui (`radix-nova` preset) as the component layer and define SME24's own tokens, type scale, shell and page primitives on top, documented in `docs/design.md`; nothing is forked and no second component library is added.

**Implementation skills**: `shadcn` (`shadcn/ui`, `.claude/skills/shadcn/`) · `tailwind-4-docs` (`Lombiq/Tailwind-Agent-Skills`, `.claude/skills/tailwind-4-docs/`) · `vercel-composition-patterns` (`vercel-labs/agent-skills`, `.claude/skills/vercel-composition-patterns/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `next-intl-app-router` (`liuchiawei/agent-skills`, `.claude/skills/next-intl-app-router/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `next-themes` (`pharbuz/ai-agent-skills`, `.claude/skills/next-themes/`) · `recharts` (`andy-spike/skills`, `.claude/skills/recharts/`) · `ask-sonner` (`emilkowalski/skills`, `.claude/skills/ask-sonner/`)

## Rationale

Reasoning and options: see [rationale.md](rationale.md).

## Feature design

### Direction

Swiss precision: near monochrome neutral surfaces, hairline borders, flat cards (no shadow except overlays), small radius, a strong type hierarchy, and one accent (the brand teal) used for primary actions, links, active navigation and focus. Status and severity colors are the only other hues, and they are always paired with a label or icon (color is never the only signal).

### Tokens (`src/app/globals.css`)

All colors are `oklch` values (a color space where lightness is perceptually even, which makes contrast predictable). The shadcn token names stay so every installed component keeps working; SME24 adds status, severity and display tokens. Exact values are the build's starting point; the contrast test (AC-1) is the authority, so a value may be nudged as long as the test passes and the hue stays.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` / `--foreground` | `oklch(1 0 0)` / `oklch(0.18 0.004 220)` | `oklch(0.16 0.004 220)` / `oklch(0.97 0 0)` | Page ground and body text (slightly cool neutrals) |
| `--card`, `--popover` | `oklch(1 0 0)` | `oklch(0.21 0.004 220)` | Surfaces, with matching `-foreground` |
| `--muted` / `--muted-foreground` | `oklch(0.965 0.003 220)` / `oklch(0.50 0.01 220)` | `oklch(0.26 0.004 220)` / `oklch(0.72 0.01 220)` | Subtle fills, secondary text (secondary text must still pass 4.5:1) |
| `--secondary`, `--accent` | `oklch(0.955 0.004 220)` | `oklch(0.27 0.004 220)` | Secondary buttons, hover fills |
| `--border`, `--input` | `oklch(0.90 0.004 220)` | `oklch(1 0 0 / 12%)` | Hairlines |
| `--primary` / `--primary-foreground` | `oklch(0.48 0.09 185)` / `oklch(0.99 0 0)` | `oklch(0.74 0.10 185)` / `oklch(0.16 0.02 185)` | Brand teal: primary buttons, links, active nav |
| `--ring` | `oklch(0.55 0.10 185)` | `oklch(0.74 0.10 185)` | Focus ring, 3:1 against both grounds |
| `--destructive` / `-foreground` | `oklch(0.55 0.22 27)` / `oklch(0.99 0 0)` | `oklch(0.70 0.19 22)` / `oklch(0.16 0 0)` | Errors, destructive actions |
| `--success` / `-foreground` | `oklch(0.52 0.14 150)` / `oklch(0.99 0 0)` | `oklch(0.75 0.15 150)` / `oklch(0.16 0 0)` | Completed, healthy |
| `--warning` / `-foreground` | `oklch(0.66 0.15 70)` / `oklch(0.20 0.02 70)` | `oklch(0.80 0.15 75)` / `oklch(0.20 0.02 70)` | Needs attention |
| `--info` / `-foreground` | `oklch(0.52 0.12 250)` / `oklch(0.99 0 0)` | `oklch(0.76 0.11 250)` / `oklch(0.16 0 0)` | Neutral notices |
| `--severity-critical` | `oklch(0.50 0.22 27)` | `oklch(0.70 0.19 22)` | Gap findings and benchmark levels, always with the level label |
| `--severity-high` | `oklch(0.62 0.18 45)` | `oklch(0.76 0.16 45)` | |
| `--severity-medium` | `oklch(0.72 0.15 80)` | `oklch(0.82 0.14 85)` | |
| `--severity-low` | `oklch(0.55 0.13 150)` | `oklch(0.76 0.14 150)` | |
| `--chart-1` to `--chart-5` | teal `0.48 0.09 185`, slate blue `0.52 0.10 250`, amber `0.70 0.14 75`, plum `0.50 0.12 320`, gray `0.60 0.01 220` | lightened by the same rule as primary | Series colors, ordered so adjacent series never pair red with green |
| `--sidebar*` | same family as `--background`, `--sidebar-primary` = brand teal | | Sidebar surfaces |
| `--radius` | `0.375rem` | | Crisp corners; the preset derives `sm` to `4xl` from it |

Each `--severity-*` and status token also gets a `-foreground` for text placed on the fill, and a `-subtle` for badges and table row highlights, defined as `color-mix(in oklch, var(--x) 12%, var(--background))` in both themes. All of them are exposed to Tailwind through `@theme inline`, three lines per name (`--color-<x>`, `--color-<x>-foreground`, `--color-<x>-subtle`) for `success`, `warning`, `info`, `severity-critical`, `severity-high`, `severity-medium` and `severity-low`, so `bg-severity-high`, `text-success` and `bg-warning-subtle` work. `:root` sets `color-scheme: light` and `.dark` sets `color-scheme: dark` so native controls follow the theme. The `@import "shadcn/tailwind.css"` line is removed (the package ships no such file; the `@theme inline` block and `tw-animate-css` already provide what it was meant to).

**Contrast pairs** (`src/lib/design-tokens.ts`, one `readonly` list used by the Vitest test and the gallery): every `--x-foreground` on `--x`; every `--x-foreground` on `--x-subtle`; and `--foreground`, `--muted-foreground`, `--primary`, `--ring`, `--border`, plus every status and severity fill, each on `--background`, `--card`, `--muted` and `--sidebar`. Ratios use 4.5:1 except the `--border` and `--ring` pairs (3:1, non text). No text token is treated as large text (WCAG's 24px, or 18.66px bold, tier), so no text pair gets the lower bar. A value with alpha (the dark `--border` and `--input`) is composited over the paired background before the ratio is computed; a `color-mix` value is computed by the test from the two parsed colors. The math (oklch to sRGB to relative luminance) comes from `culori`, added as a dev dependency, and lives in `src/lib/contrast.ts` as pure functions.

### Typography

- Fonts: Geist Sans (body, headings) and Geist Mono (identifiers, code, run ids), self hosted through `next/font` as today. Fix the mapping: `--font-sans: var(--font-geist-sans)` in `@theme inline` (today it points at an undefined variable and the stack falls back), and move the two `next/font` variable classes from `body` to `html`, because `font-sans` is applied on `html`. `--font-heading` keeps chaining through `--font-sans`.
- App scale (Tailwind defaults, no new sizes): body `text-sm` (14px), secondary `text-xs`, `h1` on pages `text-2xl font-semibold tracking-tight`, section titles `text-lg font-semibold`, card titles `text-base font-medium`.
- Marketing display scale added as utilities in `@theme`: `--text-display-lg: 3.5rem` (line height 1.05), `--text-display: 2.75rem` (1.1), `--text-display-sm: 2.25rem` (1.15); used only under `(marketing)`.
- Figures: `tabular-nums` on every numeric table cell and KPI number so CHF amounts align; number and date formatting itself belongs to feature 5 (localization) and is not decided here.
- Line length: prose blocks cap at `max-w-prose`.

### Spacing, layout and radius

- Spacing: Tailwind's default 4px scale, no custom steps. Page gutter `px-6` (`px-4` under 640px), vertical rhythm between sections `gap-8`, inside cards `p-6`, form field gap `gap-4`.
- Widths: signed in content `max-w-7xl` beside the sidebar, marketing `max-w-6xl`, forms `max-w-2xl`.
- Density: the preset's control sizes stay (default buttons and inputs are 32px tall). Tables get `density="compact"` (row padding `py-1.5` instead of `py-3`) for ops lists; the density is a prop on the shared `Table` set through a `data-density` attribute.
- Radius `0.375rem`; the preset's derived scale (`sm` to `4xl`) and its per component assignments apply unchanged from the new base.
- Elevation: no shadows on cards; overlays use the preset's shadow. Borders do the work.

### Theme

- `next-themes` `ThemeProvider` wrapped in a small client component (`src/components/theme-provider.tsx`) with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`; it writes the class before first paint through its inline script, so static marketing pages and `force-dynamic` areas behave the same. Nesting in `src/app/[locale]/layout.tsx`: `NextIntlClientProvider` > `ThemeProvider` > `AnalyticsProvider` > children. The provider takes `children` as a prop, so pages and layouts below it stay server rendered and marketing stays static. `suppressHydrationWarning` on `html` stays.
- Preference lives in the browser (`localStorage`, key `theme`). No cookie, no database column. A user's choice is per device by design.
- `ThemeToggle` (client component): a segmented pill of three icon radios (system, light, dark) in a `radiogroup` with arrow key focus, the Vercel dashboard pattern, used in the marketing header and footer, the auth pages and the gallery; `ThemeSubmenu` is the same three choices as a submenu of the sidebar user menu. It marks the current choice only after mount (the `next-themes` hydration guard), leaving every radio unchecked until then, so server and client markup match. Without JavaScript it is absent and the system preference applies.
- The Sonner toaster receives `theme={resolvedTheme}` from `next-themes` (the shadcn `Sonner` wrapper does this) so toasts follow the theme instead of Sonner's light default.
- Motion: overlays and toasts use the preset's `tw-animate-css` fades and slides (150 to 200ms). A global rule under `@media (prefers-reduced-motion: reduce)` sets `animation-duration: 1ms`, `transition-duration: 1ms`, `animation-iteration-count: 1` and `scroll-behavior: auto` (all `!important`); 1ms rather than zero so Radix exit animations still complete and overlays unmount.

### Shell and page primitives (`src/components/shell/`, `src/components/`)

- `AreaShell` stays an async server component: it reads the claims (email, role) and the locale as today and passes `{ area, email, role, locale }` to a client `AppSidebar` (`src/components/shell/app-sidebar.tsx`) built on the shadcn `Sidebar` and `SidebarProvider`. The sidebar: header with the wordmark (text "SME24" for now, an `<svg>` slot reserved for a logo), nav from `src/components/shell/nav.ts` (a `readonly` array per area of `{ href, labelKey, icon: LucideIcon }`, a component reference, no client directive, importable from server code; today: one "Overview" item per area, plus "Design gallery" under admin), footer user menu (`DropdownMenu`: email and role, a `LocaleMenuItems` submenu, a theme submenu, sign out via the existing `signOut` action). Collapsible to icons, the collapsed state kept in shadcn's `sidebar_state` cookie; below `md` it is a `Sheet` opened by a menu button in a top bar. A skip link ("Skip to content", targeting `#main`) is the first element in `body` in both the area shell and the marketing layout.
- `LocaleMenuItems`: the two locales as `DropdownMenuSub` items for the user menu, reusing the navigation from `src/i18n/navigation`; the existing `LocaleSwitcher` (a `nav` with two links) stays for the marketing header; since 2026-09-07 it renders as a segmented pill matching `ThemeToggle` (same 28px height, border, radius and accent fill on the active segment), with text segments that stay real links.
- Error and loading boundaries: `error.tsx` and `loading.tsx` sit beside each area `layout.tsx`; Next.js renders them inside that layout, so the sidebar stays visible while a page errors or loads.
- `PageHeader`: `title` (required), `description`, `breadcrumb` (items array rendered with `Breadcrumb`), `actions` (React node). Renders `h1`; pages must not render another `h1`.
- `PageStack`: the content column (`flex flex-col gap-8 max-w-7xl`).
- `EmptyState`: `icon` (lucide), `title`, `description`, optional single `action`.
- `ErrorState`: `title`, `description`, `onRetry` (calls the boundary `reset`), `eventId` shown as "Reference: …" so a user can quote it to support.
- `MarketingHeader`: wordmark, nav links, locale switcher, theme toggle, sign in; links collapse into a `Sheet` under `md`.
- Icons: lucide, `size-4` inline, decorative icons `aria-hidden`, icon only buttons carry `aria-label`.

### Component inventory (installed with the shadcn CLI, styled by the tokens)

| Group | Components | Notes |
|---|---|---|
| Forms | `Form`, `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Label` | React Hook Form plus Zod per spec 0001; errors inline under the field, `aria-invalid` and `aria-describedby` wired by `Form` |
| Data | `Table` (with `density`), `Card`, `Badge` (variants: default, secondary, outline, success, warning, info, destructive, critical, high, medium, low), `Tabs`, `Pagination`, `Skeleton` | `density` is a prop on the `Table` root that sets `data-density` and the `group/table` class; `TableCell` and `TableHead` read it with `group-data-[density=compact]/table:py-1.5`. Table cells may truncate only with a `Tooltip` holding the full text (a `title` attribute is not exposed on focus); nothing else truncates |
| Overlays | `Dialog`, `Sheet`, `DropdownMenu`, `Tooltip`, `Popover`, `Sidebar` | Focus trapped and returned by Radix |
| Feedback | `Alert` (variants: default, info, success, warning, destructive), `Progress`, `Separator`, `Breadcrumb`, `Sonner` | Toaster mounted once in the locale layout inside `ThemeProvider` |
| Charts | `Chart` (Recharts) | `ChartContainer` config maps series to `--chart-*`; charts are client components, kept out of server component trees |
| Shared (hand written) | `PageHeader`, `PageStack`, `EmptyState`, `ErrorState`, `ThemeToggle`, `MarketingHeader`, `AreaShell` | `src/components/`, named exports, one line JSDoc each |

### Gallery (`/admin/design`)

`src/app/[locale]/admin/design/page.tsx` (ops only, `force-dynamic` like the rest of `/admin`) renders sections from `src/components/gallery/`: tokens (a client section that reads each pair from `src/lib/design-tokens.ts`, resolves the live values with `getComputedStyle` after mount and shows the ratio beside each swatch), type scale, buttons and badges in every variant and size, form controls (default, focused, invalid, disabled), table (default and compact, with a truncated cell), overlays (each with an open trigger), states (skeleton, empty, error, a toast trigger), charts (bar, line). Each section has an `h2`, so axe and a screen reader user can navigate it. The gallery is a development aid; it ships to production behind the ops role and shows no customer data, which is accepted.

**Data model sketch**: no database change. Two values persist, both in the browser: the theme preference (`localStorage.theme`, written by `next-themes`) and the sidebar collapsed state (the `sidebar_state` cookie, written by shadcn's `SidebarProvider`). Nothing in `supabase/schemas/` changes.

**State transitions**: theme preference: `system` ⇄ `light` ⇄ `dark`, any to any, triggered by the user in `ThemeToggle`; the applied class is derived from the preference and, for `system`, from `prefers-color-scheme`.

**API surface**: none. No server actions, route handlers or tasks are added. The gallery is a server rendered page; the sign out action already exists.

| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `/[locale]/admin/design` | GET (page) | none | rendered gallery | ops role (proxy area gate) | forbidden page for other roles, sign in redirect when signed out |

**Value sourcing**:
| Action | Value produced / displayed | Source |
|---|---|---|
| First paint | Theme class on `html` | `next-themes` inline script reading `localStorage.theme`, else `prefers-color-scheme` |
| `ThemeToggle` | Current preference and the three choices | `useTheme()` from `next-themes`, read only after mount; labels from `messages/<locale>.json` (`theme.*`) |
| Shell, menus, gallery, states, toasts | All strings | `messages/de.json` (authoritative key set) and `messages/en.json`, namespaces `shell`, `nav`, `theme`, `gallery`, `states`; `tests/messages.test.ts` fails when the deep key sets differ |
| Playwright gallery test | Signed in ops session | The `signIn` helper extracted from `e2e/roles.spec.ts` into `e2e/helpers.ts`, using the seeded ops user and `E2E_SEED_PASSWORD`; the test skips when the variable is unset, exactly like the roles test |
| Playwright gallery test | Dark theme under test | `page.addInitScript` writes `localStorage.theme = "dark"` before navigation; light uses `"light"` |
| `AreaShell` | Nav items per area | `src/components/shell/nav.ts`, keyed by `Area` from `src/lib/auth/roles.ts` |
| `AreaShell` user menu | Email, role, current locale | Supabase claims through `roleFromClaims` (already read in the shell); locale from `getLocale()` |
| `PageHeader` | Title, description, breadcrumb, actions | Props from the page, strings from next-intl |
| `ErrorState` in `error.tsx` | Sentry event id | `useEffect(() => setEventId(Sentry.captureException(error)), [error])` in the client boundary; `error.digest` shown when the id is empty |
| Contrast test | Token pairs and their ratios | Parses `src/app/globals.css` `:root` and `.dark` blocks with the pair list from `src/lib/design-tokens.ts`; ratios from `src/lib/contrast.ts` (`culori`), alpha composited over the paired background, `color-mix` evaluated from the two parsed colors |
| Badge and chart colors | Fill per status, severity, series | The token table above, consumed as `bg-*` utilities and `var(--chart-n)` |
| Gallery swatches | Ratio shown next to each pair | Client section: the same pair list, live values from `getComputedStyle` after mount, ratio from `src/lib/contrast.ts` |
| Table density | Row padding | `density` prop, default `"default"`, `"compact"` opt in per table |

**Key invariants**:
- Every color pair listed in the contrast test meets 4.5:1 (text) or 3:1 (large text, borders, focus ring) in both themes; the test is the gate.
- Color is never the only carrier of meaning: status and severity always have a label or icon.
- Exactly one `h1` per page, rendered by `PageHeader` (or the marketing page's hero).
- Only table cells may truncate text, and always with the full text in a `Tooltip` shown on hover and on focus.
- No component reads or writes theme state except through `next-themes`.
- Every string in the shell, gallery and state primitives comes from next-intl.

**Security model**: no new data. `/admin/design` is gated by the existing proxy area rule (ops role from `app_metadata.role`); nothing else changes. No compliance scope beyond WCAG 2.2 AA.

**Configuration required**: none. No new environment variables or credentials.

**Critical test scenarios**:
- Happy path: an ops user opens `/de/admin/design`, switches to dark, reloads, and sees dark with every section rendered; axe reports no violations in either theme, verifies **AC-3**, **AC-6**, **AC-10**
- Contrast gate: lowering `--muted-foreground` lightness in `globals.css` until it falls under 4.5:1 makes the Vitest contrast test fail, verifies **AC-1**
- Keyboard: from the top of `/de/app`, Tab reaches the skip link, then the sidebar items, the user menu, and Enter opens it; the theme submenu is operable by arrow keys, verifies **AC-4**
- Mobile: at 375px the sidebar is hidden, the menu button opens a sheet, focus is trapped and returns to the button on close, verifies **AC-4**
- Failure state: a page whose loader throws renders `ErrorState` with a reference id and a retry button that re renders the page, verifies **AC-7**
- Auth/permission: a client user requesting `/de/admin/design` gets the forbidden page, a signed out visitor is redirected to sign in, verifies **AC-6**
- Localization: every added string has `de` and `en` entries (the existing messages test or a new one compares key sets), verifies **AC-12**

## Build plan

Ordered as Tracer Bullet slices: the first slice threads tokens, theme and the gallery through the real app so the accessibility pipeline runs on day one, later slices thicken the same thread.

1. **Thin thread: brand tokens, theme, gallery stub, axe.** Remove the `shadcn/tailwind.css` import and confirm `pnpm build` passes, replace the neutral values with the brand primary, ring and neutral tokens from the table, fix `--font-sans` and move the font variable classes to `html`, add `color-scheme` to `:root` and `.dark`, add `next-themes` through `theme-provider.tsx` in the stated nesting with a minimal mounted safe `ThemeToggle` in the current shell and marketing header, create `/admin/design` with a tokens section, extract `signIn` to `e2e/helpers.ts`, and add a Playwright test that signs in as ops, forces each theme through `addInitScript`, asserts the computed `body` font and runs axe on the gallery in light and dark for `de` and `en`, satisfies **AC-1** (build), **AC-2**, **AC-3**, **AC-10** (pipeline)
2. **Full token set and contrast gate.** Add status, severity, `-subtle`, chart and sidebar tokens in both themes, expose them in `@theme inline` (three lines per name), add the display type scale and the reduced motion rule, add `culori` as a dev dependency, write `src/lib/design-tokens.ts` (the pair list), `src/lib/contrast.ts` and the Vitest test that parses `globals.css` and checks every listed pair, satisfies **AC-1**, **AC-2**, **AC-10** (motion)
3. **Sidebar shell.** Install `Sidebar`, `Sheet`, `DropdownMenu`, `Tooltip`; split `AreaShell` (server, claims) from `AppSidebar` (client) with the nav config, `LocaleMenuItems`, the user menu (locale, theme, sign out), the skip link in both layouts and the mobile sheet; add all shell strings to `de` and `en` under `shell`, `nav` and `theme`, satisfies **AC-4**, **AC-12**
4. **Page primitives and states.** Add `PageHeader`, `PageStack`, `EmptyState`, `ErrorState`, install `Skeleton`, `Breadcrumb`, `Sonner`, mount the toaster with the resolved theme; add `loading.tsx` and `error.tsx` (Sentry capture in an effect, event id or digest shown) beside each area layout; move the `h1` of the `/app`, `/expert` and `/admin` overview pages into `PageHeader` over a `PageStack`; build the responsive `MarketingHeader`; update the heading assertion in `e2e/roles.spec.ts` and the single link assertion in `tests/hero.test.tsx` for the new markup, satisfies **AC-5**, **AC-7**, **AC-8**
5. **Component inventory in the gallery.** Install the remaining forms, data and overlay components, add `density` to `Table` (root attribute, cells read it), the `Badge` status and level variants and the `Alert` variants, and gallery sections for every group with every state (including an invalid form field with an inline Zod error and a truncated cell with a `Tooltip`), plus the overflow and tooltip on focus assertions in the Playwright test, satisfies **AC-6**, **AC-8**, **AC-10** (long text)
6. **Charts.** Install `Chart`, map the config to `--chart-*`, add a bar and a line chart to the gallery, verify tooltip and legend contrast in both themes, satisfies **AC-9**
7. **Tests and the design reference.** Vitest component tests for `PageHeader`, `EmptyState`, `ErrorState`, `ThemeToggle`, and `tests/messages.test.ts` comparing the deep key sets of `de.json` and `en.json`; extend the Playwright test with the keyboard and 375px scenarios; write `docs/design.md` from the sections above and check every token name it lists against `globals.css`, satisfies **AC-10**, **AC-11**, **AC-12**

## Consequences

**Positive**:
- Later features compose from a fixed inventory and a written reference, so pages stay consistent without design review on every pull request.
- Contrast and accessibility are enforced by tests in CI, not by memory.
- The shell scales to the admin and client page counts of Slices 3 to 8 without another layout change.
- One palette and one component set cover marketing and product, so sign in and consent pages do not feel like a different app.

**Negative / tradeoffs**:
- Theme preference is per browser; a user who switches devices picks it again. Moving it to the profile later means a migration and a server action.
- Recharts renders client side only; charts add to the client bundle and cannot be server rendered into emails or PDFs (feature 18 will need a separate rendering path for the gap report).
- The gallery is another page to keep current; a primitive added without a gallery section escapes the axe scan. The rule in `design.md` is that a new primitive lands with its section.
- shadcn components are copied into the repo, so upstream fixes arrive only when someone runs the CLI diff; that is the price of owning the styling.
- The `radix-nova` preset's 32px controls are compact for marketing forms; the marketing pages use the `lg` size for primary calls to action.
- The gallery axe scan needs a signed in ops user, so it runs locally and against staging (where the seed is applied) and skips on preview deployments; the Vitest contrast test is the only accessibility gate that runs on every commit.

**Neutral**:
- `next-themes`, `recharts` and `sonner` join the dependencies, and `culori` joins the dev dependencies for the contrast math; all are stable, widely used and have no server side footprint.
- Number, date and CHF formatting are deliberately left to feature 5; the tokens only make the figures align.
- `docs/design.md` becomes the design source of truth that `/develop` reads for every UI feature; a change in direction updates it and this spec together.

## Amendment 2026-09-04: brand identity

The SME24 Brand Identity Guidelines v1.0 and the campaign decks ("SME24. Einfach. Anders." / "SME24. Just. Different.") arrived after this spec was accepted and supersede the direction, palette and typeface above. Recorded here for `/architect`; `docs/design.md` is updated in full.

- **Direction**: "authoritative, industrial, minimalist, high contrast" replaces "Swiss precision" with a teal accent. There is no accent hue; status and severity hues stay as functional colors.
- **Palette**: Jet Black `#000000`, Pure White `#FFFFFF`, Obsidian Black `#141414` (white 60, jet 30, obsidian 10). Light theme: white page, jet sidebar. Dark theme: jet page, obsidian cards, popovers and sidebar. `--primary` and `--ring` are jet on white and white on jet. Chart series are monochrome first (ink, mid gray, light gray) then slate blue and amber. The neutral hue tint (220) is gone; all grays are `oklch(L 0 0)`. New tokens: `--sidebar-muted-foreground` and the brand constants `--color-jet`, `--color-pure-white`, `--color-obsidian`.
- **Typeface (AC-2 changes)**: Urbanist replaces Geist Sans for all text; Geist Mono stays for identifiers. The Playwright assertion expects the computed `body` font to start with `Urbanist`. The brand hierarchy replaces the app scale weights: Display 800 −3% (`text-display-*` now carry weight and tracking), Headline 700 −2% (`tracking-headline`), Subhead 600, Body 400, Caption 500 caps (`eyebrow` utility, `tracking-caps`), plus `tracking-lockup` (+34%) for the descriptor.
- **Radius**: `0.125rem` instead of `0.375rem`, matching the block forms of the mark.
- **Contrast pairs**: `sidebar` leaves the shared grounds; the sidebar gets its own text pairs (`sidebar-foreground`, `sidebar-muted-foreground` on `sidebar` and `sidebar-accent`) and `sidebar-ring` at 3:1.
- **New primitives** in `src/components/brand/`: `BrandMark` (bare, badge, keyline; traced path, to be replaced by the asset kit file), `Logo` (lockup in the guide's proportions, replaces `Wordmark`), `Statement` with `SquareStop` (campaign sentences with the square full stop), `Signature` (campaign sign-off), the inverse block pattern (`className="dark"` on a section) and `src/app/icon.svg` (replaces `favicon.ico`). The gallery gains a Brand section; the landing hero and the marketing footer use them.
- **Campaign blocks** (`src/components/brand/campaign.tsx`): `CampaignPiece`, `CampaignFrame`, `CampaignImage`, `CampaignGrid`, `CampaignWall` reproduce the deck format (object on white, statement, subline, signature; pair, contrast with an empty frame, four panel strip, type only piece, wall) as the section pattern for feature 13; the gallery gains a Campaign section with development placeholders.
- **Messages**: new `brand` namespace (`descriptor`, `signature`, `tagline`, `domain`), `landing` rewritten in the brand voice, `gallery.brand` and `gallery.type` extended.
- **Follow-up for `/architect`**: fold this amendment into `## Feature design` (token table, typography, direction) and `## Decision`; decide whether the marketing site (feature 13) adopts the campaign format (one object, one statement, the signature) as its section pattern.

## Amendment 2026-09-04: Geist as the brand face

Owner decision, same day: Geist Sans stays the brand face and Urbanist is dropped. This supersedes the typeface bullet of the amendment above; everything else in it stands.

- **Typeface (AC-2)**: Geist Sans for all text (`--font-geist-sans`, fallback Helvetica and Arial), Geist Mono for identifiers. The brand hierarchy (Display 800 −3%, Headline 700 −2%, Subhead 600, Body 400, Caption 500 caps, `tracking-lockup`) is unchanged and now set in Geist. The Playwright assertion expects the computed `body` font to start with `Geist` and not `Geist Mono`.
- **Why**: the Geist pair is cleaner and reads as one system with the monospace face; Urbanist added a second vendor family for no gain in voice.
- **Brand guidelines**: v1.0 names Urbanist. The guidelines diverge from the product until they are revised; `docs/design.md` is the source of truth for the app.
- **Follow-up for `/architect`**: fold this into `### Typography` together with the amendment above.

## Amendment 2026-09-04: light sidebar in the light theme

Owner decision, same day: the signed in sidebar is a light gray of the page family in the light theme (`--sidebar` `oklch(0.975 0 0)`, jet text, `--sidebar-accent` `oklch(0.92 0 0)`, `--sidebar-border` equal to `--border`), no longer jet black. The dark theme is unchanged (obsidian sidebar on a jet page). This supersedes the "Light theme: white page, jet sidebar" clause of the brand identity amendment; the 30% jet share is now carried by the mark, text, the primary button and the active item rather than by a surface.

- **Why**: a black column beside a white page reads as two products in one window and dominates every light screen; the mark and the type carry the brand strongly enough.
- **Brand guidelines**: v1.0 places jet on the sidebar. The guidelines diverge from the product until they are revised; `docs/design.md` is the source of truth for the app.
- **Contrast**: the pairs in `src/lib/design-tokens.ts` are unchanged; the gate verifies the new values.
- **Follow-up for `/architect`**: fold this into `### Color` together with the brand identity amendment.

## Amendment 2026-09-04: shadcn Field replaces Form

Found by `/check verify`: the installed forms primitive is shadcn `Field` (`src/components/ui/field.tsx`, the `Field`, `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`, `FieldSet` and `FieldLegend` family), not the older `Form` wrapper. `docs/design.md` already documents the `Field` family; **AC-8** and the Forms row of the component table in `## Feature design` still say `Form`. The behaviour (Zod errors inline under the field, `aria-invalid` and `aria-describedby` on the control) is unchanged.

- **Follow-up for `/architect`**: replace `Form` with `Field` in **AC-8** and the Forms row, and confirm **AC-6** counts the `Field` family as the installed base set.

## Amendment 2026-09-04: hairlines leave the contrast gate, chart series join it

Found by `/check review`: **AC-1** and the first key invariant name `--border` among the pairs that must reach 3:1, but the built gate (`src/lib/design-tokens.ts`) checks `--input` and `--ring` instead, and `docs/design.md` calls `border` the decorative hairline. Measured, the hairline sits at 1.3:1 on the page in both themes, so the contract as written cannot pass. Decision, on the reviewer's recommendation: the code and `design.md` are right and the contract changes.

- **Hairlines are decorative.** `--border` and `--sidebar-border` draw dividers and card edges; no control is identified by them (every control is outlined by `--input` and focused by `--ring`, and tables carry their structure in markup). WCAG 2.2 SC 1.4.11 (non text contrast) applies to the visual boundary needed to identify a control and to graphics needed to understand content, so a divider that only separates is outside it. A hairline at 3:1 would be a heavy mid gray line (about `oklch(0.66 0 0)` on white) and would end the hairline look the brand guidelines ask for.
- **AC-1, amended clause**: "... and fails below 4.5:1, except the `--input`, `--ring` and `--sidebar-ring` boundary pairs and the `--chart-1` to `--chart-5` series pairs, which must reach 3:1 (the WCAG tier for non text elements). `--border` and `--sidebar-border` are decorative hairlines and are not in the pair list."
- **Key invariant, amended**: "Every color pair listed in the contrast test meets 4.5:1 (text) or 3:1 (control boundaries, the focus ring, chart series) in both themes; the test is the gate. Hairline dividers are decorative and outside it."
- **Chart series join the gate.** Bars and lines carry information, so 1.4.11 applies to them; `--chart-1` to `--chart-5` are now checked at 3:1 on `--background`, `--card` and `--muted` in both themes (they were checked for existence only). The values that failed moved along the gray axis with the hue unchanged: light `--chart-2` `oklch(0.45 0 0)`, `--chart-3` `oklch(0.62 0 0)` and `--chart-5` `oklch(0.62 0.14 75)`; dark `--chart-3` `oklch(0.58 0 0)`.
- **Consequence**: a hairline that must be perceived on its own (a table whose rows are told apart only by lines, a gridline that carries a value) is a design question to raise, not a token to darken; give it markup or a label instead.
- **Follow-up for `/architect`**: fold the amended clause into **AC-1** and the invariant, and drop `--border` from the "Contrast pairs" paragraph of `## Feature design`.

## Follow-up

- [ ] Feature 5 (localization): decide number, date and CHF formatting; the tabular figure rule here assumes it.
- [ ] Feature 13 (marketing site): the hero and section patterns compose from `MarketingHeader`, the display scale and the tokens; add marketing specific blocks there, not here.
- [ ] Feature 18 (gap report): pick a server side chart rendering path for PDF and email, since Recharts is client only.
- [ ] Replace the traced path in `src/components/brand/brand-mark.tsx` with the SVG from the brand asset kit (service@sme24.ch); nothing else changes.
- [ ] Forced colors mode (Windows high contrast) is not tested automatically; check the gallery by hand once and note any component that loses its borders.
- [ ] After merge, `/sync` records in root `AGENTS.md`: `docs/design.md` as the design reference, the rule that new primitives land with a gallery section, and the three new dependencies.
- [ ] `next-themes`, `recharts` and `ask-sonner` conventions are installed but not yet in root `AGENTS.md` `## Agent skills`; they apply to every UI feature and belong at root level, with `defi-naly/skillbank@shadcn-charts` and `laguagu/claude-code-nextjs-skills@nextjs-shadcn` on the `Declined:` line.
