# Review, feat/design-system, 2026-09-04

**Reviewed by**: Claude Fable 5.1 in a fresh session (author on Claude Fable; the brief asked for a different model, none was available in this session, so read this as a same-family review with no shared context)
**Scope**: 105 files, branch vs main (merge base c60bbc2): 104 committed plus the untracked `tests/chart.test.tsx`; `public/campaign/*`, `.claude/skills/**`, `skills-lock.json` and lock files skipped
**Verdict**: Changes requested

## Summary

The branch installs the SME24 brand tokens in light and dark, a `next-themes` theme with a no-flash script, the shadcn base set localized through a `ui` namespace, a sidebar shell for the three signed in areas, page primitives and area states, a Recharts wrapper with resize throttling, the ops only gallery with axe coverage, and a contrast gate that really parses `globals.css` and computes ratios (I verified it fails when `--muted-foreground` is lightened). Quality is high: hydration is handled deliberately, focus return on the mobile sheet is explicit, tests assert behaviour rather than mocks. Two things need fixing before merge: AC-1 names `--border` in the 3:1 tier and the code silently dropped it from the gate (the hairline measures 1.3:1, so it cannot pass as written), and the shared error boundary, the one piece of new code that handles errors, has no unit test. Vitest (221), typecheck and Biome are green on this tree.

## Major

### 🟠 `--border` left out of the contrast gate without a spec amendment, `src/lib/design-tokens.ts:79-84`
**Problem**: AC-1 and the "Key invariants" of spec 0003 require `--border` on every ground at 3:1. The pair list checks `--input` and `--ring` instead and the comment declares hairlines decorative. `docs/design.md:66` documents that decision, but the spec has no amendment for it (the four amendments cover brand, typeface, sidebar and Field). Measured: light `--border` on `--background` is 1.3:1, on `--muted` 1.2:1; dark 1.3:1 on the page and 1.5:1 on a card. **Why it matters**: the spec is the contract; the gate was narrowed to make the values pass rather than the spec being changed. Every default border in the app comes from this token (`* { border-border }` in `globals.css:250`), including card edges and table row dividers, and the brief explicitly asks the gate to cover it. **Suggested fix**: pick one. Either add the `--border` boundary pairs and raise the hairline (a value near `oklch(0.66 0 0)` reaches 3:1 on white; that changes the look considerably), or keep the decorative reading, which is defensible under WCAG 1.4.11, and record it as a dated amendment to AC-1 and the invariants with the 1.4.11 reasoning, so `design.md` and the spec agree. The second is what I would do.

### 🟠 The shared error boundary has no test, `src/components/shell/area-error.tsx:19-36`
**Problem**: `AreaError` is the one new component that handles errors: it captures to Sentry in an effect, falls back from the event id to `error.digest`, and wires `retry`. `tests/primitives.test.tsx` covers `ErrorState` only; `AreaError` is exercised nowhere (the Playwright suite has no throwing page). **Why it matters**: this is what every user sees when a signed in page fails, and it is the only place the Sentry reference is produced. The digest fallback branch is currently unreachable (see the Minor below), which a test would have surfaced. **Suggested fix**: a Vitest test that mocks `@sentry/nextjs`, renders `AreaError` with an error carrying a digest, asserts one `captureException` call, the reference shown, and that the retry button calls `retry`. Cover the "capture returns an empty id" branch too.

## Minor

### 🟡 Reference id is shown even when Sentry is disabled, and the digest never is, `src/components/shell/area-error.tsx:23-33`
**Problem**: `Sentry.captureException` returns a generated id whether or not a client is enabled (`src/instrumentation-client.ts:8` disables it without a DSN), so `eventId` is never empty and `error.digest` is never displayed. The first paint shows the digest, the effect then swaps it for the Sentry id. **Why it matters**: on a preview without a DSN the user quotes a reference support cannot find, and the digest, which is what matches the server logs per the Next.js docs, is hidden on every environment. **Suggested fix**: show the digest whenever present and add the Sentry id only when the client is enabled (`Sentry.getClient()` is defined), or show both.

### 🟡 Hard coded screen reader string bypasses next-intl, `src/components/ui/breadcrumb.tsx:92`
**Problem**: `BreadcrumbEllipsis` renders the literal "More" while `ui.morePages` already exists and is used by `pagination.tsx:102`. **Why it matters**: AC-12; a German screen reader user hears English. **Suggested fix**: `t("morePages")` through `useTranslations("ui")` like the sibling components.

### 🟡 Second class merger imported from the `cn` npm package, `src/components/ui/field.tsx:4`, `label.tsx:3`, `separator.tsx:3`, `package.json:36`
**Problem**: three primitives import `cn` from the `cn` package (shadcn's compiled merger) while every other file uses `@/lib/utils`. **Why it matters**: two implementations of class conflict resolution in one codebase, an extra production dependency, and a future `pnpm dlx shadcn add` will keep introducing it. **Suggested fix**: point the three imports at `@/lib/utils`, drop the dependency, and check whether `components.json` aliases need `utils` set so the CLI stops emitting the package import.

### 🟡 Chart series colors fall under 3:1 against the page, `src/app/globals.css:172` and `:234`
**Problem**: `--chart-3` is `oklch(0.78 0 0)` light and `oklch(0.45 0 0)` dark, which measures 2.0:1 and 2.8:1 against `--background`; the gallery's second series ("findings") uses it in both charts. `CHART_TOKENS` are checked for existence only. **Why it matters**: bars and lines are graphical objects that carry information, so WCAG 1.4.11 applies; AC-9 says "checked by eye" and axe skips SVG, which is exactly why a token gate is the cheap net. **Suggested fix**: add `boundary(chartToken, ground)` pairs for the chart tokens and darken the light gray (`oklch(0.62 0 0)` reaches about 3.1:1 on white).

### 🟡 The project `ThemeProvider` wrapper is untested; the toggle test bypasses it, `src/components/theme-provider.tsx:21-28`, `tests/theme-toggle.test.tsx:4`
**Problem**: the inert-script switch from commit 3769c1d (`useSyncExternalStore` with a server snapshot of `false`) is the part most likely to regress on a next-themes upgrade, and the test imports `ThemeProvider` from `next-themes` directly. **Why it matters**: the hydration contract (executable script in server HTML, `text/plain` on client mounts) has no assertion. **Suggested fix**: render through `@/components/theme-provider` and assert the script's `type` attribute is absent on a `renderToString` pass and `text/plain` after a client render.

### 🟡 `splitSentences` splits on every period, `src/components/brand/statement.tsx:15` and `:47`
**Problem**: the lookbehind split treats "sme24.ch", "z.B." and "1.5" as sentence ends; and `Statement` keys lines by their text, so "Nein. Nein." produces duplicate keys. **Why it matters**: feature 13 will feed real marketing copy through this; a domain or an abbreviation breaks into lines with square stops. **Suggested fix**: split on a period followed by whitespace or end of string only, and key by index (the list is static per render).

## Nits

- ⚪ `src/components/gallery/tokens-section.tsx:41-46`, one `MutationObserver` on `html` per swatch (about ninety); lift it to the section and pass a tick down.
- ⚪ `tests/chart.test.tsx:112`, the `getBoundingClientRect` spy is never restored (`clearMocks` resets calls only); the first describe passes only because it runs first. Add `vi.restoreAllMocks()` to `afterEach`.
- ⚪ `tests/chart.test.tsx:89`, `FakeResizeObserver` is a class; a factory object satisfies the "classes only for Error subclasses" rule in test code too.
- ⚪ `src/components/shell/locale-menu-items.tsx:42`, `router.replace(pathname, …)` drops the query string on a locale switch (the marketing `LocaleSwitcher` has the same gap).
- ⚪ `src/app/[locale]/forbidden/page.tsx:21-25`, the title renders twice, as `h1` and as the `EmptyState` title.
- ⚪ `src/components/ui/sonner.tsx:40`, `classNames.toast: "cn-toast"` is a leftover with no matching style.
- ⚪ `src/hooks/use-mobile.ts:5`, exported hook without the one line JSDoc the rules require; `sidebar.tsx` and `chart.tsx` exports are in the same state (shadcn output, but the rule has no exemption).
- ⚪ `biome.json:79-93`, a11y and security rules are switched off for the whole `src/components/ui/**` folder; scope the overrides to the files that need them (`sidebar.tsx`, `chart.tsx`) so a new primitive is still linted.
- ⚪ `src/components/ui/sidebar.tsx:28` and `:91-102`, the global Cmd/Ctrl+B shortcut collides with the bookmarks sidebar in Firefox; consider dropping it or gating it to the shell.
- ⚪ `src/components/shell/page-skeleton.tsx:22`, `aria-live` on content that mounts with the region announces nothing; `aria-busy` plus the `sr-only` text is enough, or announce through the toaster's live region.
- ⚪ `src/app/[locale]/layout.tsx:23`, the metadata description is hard coded English for both locales (pre-existing pattern; `generateMetadata` with next-intl fixes it).
- ⚪ `public/campaign/firmenwagen.png` at 600 KB and four JPEGs above 400 KB; `next/image` re-encodes on demand, but a JPEG or WebP source halves the origin fetch.
- ⚪ `src/components/ui/sidebar.tsx:80`, the `sidebar_state` cookie is written without `SameSite`; browsers default to Lax, so add it explicitly.

## Strengths

- The contrast gate is real: it parses the `:root` and `.dark` blocks, follows `var()` and evaluates `color-mix` in oklch, composites alpha over the ground and clips to sRGB before measuring. Lightening `--muted-foreground` to `oklch(0.62 0 0)` yields 3.6:1 and a red test, as AC-1 demands.
- `theme-provider.tsx` solves the remount warning without touching the server HTML: the server snapshot keeps the script executable for hydration, client mounts get `text/plain`. The script body is built from constants only, so there is no injection surface; when a CSP arrives, next-themes' `nonce` prop is the one addition needed.
- `chart.tsx` passes `resizeThrottleMs` to Recharts' `debounce`, which in 3.8.0 is an es-toolkit throttle with `leading: false, trailing: true`; the test drives the real `ResizeObserver` callback with fake timers and proves no repaint inside the window and a trailing render at the final size.
- The mobile sidebar returns focus to the trigger explicitly (`onCloseAutoFocus`), because the sheet opens through state rather than a `SheetTrigger`; the 375px Playwright scenario asserts it.
- `isNavItemActive` gets the area root exactly right and is unit tested against sibling prefixes (`/admin/designer`).
- `error.tsx` uses the Next.js 16 `retry` prop, matching the docs shipped in `node_modules/next/dist/docs`, not the older `reset`.
- Message parity is checked deeply, including ICU placeholder sets, and the shadcn primitives (sheet, dialog, pagination, sidebar) read their labels from the `ui` namespace instead of the upstream English.
- The skip link works as intended: `focus:fixed` is declared after `not-sr-only` in the compiled CSS, so it does not become a static flex item when focused.

## Test coverage

- Vitest: 221 tests across 11 files pass on this tree; typecheck and Biome are clean. New unit coverage: contrast gate and helpers, message parity, `PageHeader`, `EmptyState`, `ErrorState`, `ThemeToggle`, nav matching, brand primitives, campaign blocks, chart container, throttling, tooltip and legend content.
- Gaps: `AreaError` (Major above), the project `ThemeProvider` wrapper (Minor above), `AppSidebar` and `LocaleMenuItems` have no Vitest coverage and rely on Playwright, `Table` density and the `Badge` variants are rendered in the gallery only, and AC-11 ("every token `design.md` names exists in `globals.css`") has no automated check (I ran one by hand: every named token exists, `--chart-n` being a placeholder).
- Playwright `e2e/design.spec.ts` is thorough (font, theme class, `color-scheme`, axe in two themes and two locales, persistence, overflow sampling, tooltip on hover and focus, keyboard shell, 375px sheet, forbidden page) but skips wherever `E2E_SEED_PASSWORD` is unset, so on previews the only accessibility gate is the Vitest contrast test, as the spec's Consequences already accept.
- Nothing tests mocks for their own sake; the chart tests assert the rendered SVG and emitted CSS, the toggle test asserts `localStorage` and the `html` class.
