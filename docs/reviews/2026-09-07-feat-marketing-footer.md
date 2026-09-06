# Review, feat/marketing-footer, 2026-09-07

**Reviewed by**: Claude Sonnet 5 (author on Claude Opus 5)
**Scope**: 13 files, branch vs main (merge base efb8230)
**Verdict**: Changes requested

## Summary
The change makes the marketing header sticky with a scroll-triggered hairline/frosted ground, moves the theme control out of the desktop header into the footer, rebuilds the locale switcher as a dropdown, and adds a global `scroll-margin-top` rule so the sticky bar stops covering focused fields and fragment targets. The mechanics (the `useScrolled` hook, the dropdown's link-based menu items, the pixel-matched trigger height) are well built and the docs/spec updates are unusually thorough. Two things need fixing before merge: the light-theme header does not actually meet the hero "without a seam" as documented, and the locale switcher's `aria-label` overrides its own visible text, which is a real WCAG 2.5.3 violation that axe's default rule set does not catch (the rule is disabled-by-default/experimental in axe-core, so `pnpm test:e2e` will stay green despite it). There's also a global-CSS scope leak into the signed-in areas and a stale doc line, both minor.

## Major

### 🟠 The "no seam" claim only holds in dark mode; light mode gets a hard seam, `src/components/marketing-header.tsx:56-60`
**Problem**: At scroll position 0 the header is `border-transparent bg-background` (fully opaque). The landing hero immediately below it is `<section className="dark bg-background text-foreground">` (`src/app/[locale]/(marketing)/page.tsx:73`), which forces jet black regardless of the page theme. In dark mode `--background` is already jet black (`oklch(0 0 0)`), so the header and hero match and there is genuinely no seam. In **light mode**, `--background` is white, so the unscrolled header is an opaque white bar sitting directly on top of a jet-black hero — the opposite of "meets the dark hero without a seam" (the stated intent, and the sentence now committed to `docs/marketing.md:23`).
**Why it matters**: This is the visual purpose of the whole sticky/frosted treatment; in the theme that most users will see by default it produces a visible hard edge instead of the intended blend, and the doc now asserts something the code does not do.
**Suggested fix**: Either make the header transparent (not just borderless) at scroll 0 so the hero shows through, or key the unscrolled background off the hero being visible (e.g. force the same `dark` treatment / an inverse background for the unscrolled state on pages with a dark hero) rather than a plain light/dark theme background. Re-check the claim in `docs/marketing.md` against whatever is implemented.

## Minor

### 🟡 Locale switcher trigger's accessible name doesn't contain its visible text, `src/components/locale-switcher.tsx:58-59`
**Problem**: `DropdownMenuTrigger` renders the visible language name (e.g. "English") as its text content, but `aria-label={t("language")}` (e.g. "Language") replaces the accessible name entirely. A screen reader announces "Language, button" while sighted users read "English" — the accessible name does not contain the visible label, failing WCAG 2.5.3 (Label in Name), part of the 2.2 AA set this project targets.
**Why it matters**: This is exactly the kind of mismatch 2.5.3 exists to prevent (voice control and screen-reader users can't correlate what they see with what they hear). It slipped past the axe gate only because `label-content-name-mismatch` ships `"enabled": false` in this axe-core version (confirmed: `axe.getRules([...]).find(r => r.ruleId === "label-content-name-mismatch")` returns `enabled: false`), so `AxeBuilder().withTags(WCAG_TAGS)` never runs it even though it's tagged `wcag21a`/`wcag253`. `pnpm test:e2e` staying green is not proof of compliance here.
**Suggested fix**: Drop the `aria-label` (the visible text "English"/"Englisch" already names the control) or use `aria-labelledby`/a visually-hidden prefix that includes the visible language name, e.g. combine "Language: English" so the spoken name is a superset of the visible text. `ThemeToggle`'s `aria-label` usages are fine by contrast — those controls have no visible text, so there's nothing to mismatch.

### 🟡 Global `scroll-margin-top` reaches every `input`/`select`/`textarea`/`fieldset` outside the marketing pages too, `src/app/globals.css:270-276`
**Problem**: `globals.css` is imported once in the root `src/app/[locale]/layout.tsx`, so this rule is not scoped to `(marketing)`. The signed-in areas (`/app`, `/expert`, `/admin`) and the auth pages have no sticky header — `src/features/auth/ui/sign-in-form.tsx` also calls `form.setFocus("email")` on error — yet every field there now gets 112px (`calc(var(--spacing) * 28)` = 28 × 0.25rem) of unneeded top scroll margin when the browser scrolls it into view.
**Why it matters**: Not a breakage, but on a short form or a small viewport this can leave a large, unexplained gap above a focused field on pages that never had the problem this rule was written to solve; the comment above the rule attributes it entirely to the marketing header, which is misleading for the next person reading it in an unrelated area.
**Suggested fix**: Scope the rule to the marketing layout (e.g. a class on the `(marketing)` layout's root element, or a CSS layer selector under `[data-marketing]`) rather than a bare element selector in the global sheet, or explicitly note in the comment that it is deliberately applied everywhere and why that's acceptable.

### 🟡 Stale claim in `docs/marketing.md` about a "Language navigation landmark", `docs/marketing.md:23`
**Problem**: The sentence carried over unchanged from before this diff still reads "...the language switch lives in the header only, so the page has one `Language` navigation landmark." The switch is no longer a `<nav aria-label="...">` — it's a `DropdownMenu` (a button plus a menu), so there is no `navigation` landmark for language at all any more.
**Why it matters**: Small, but this file was touched in this very diff to describe the new header, so the stale clause right next to the new text is likely to mislead whoever next edits this section or a test that asserts "one Language navigation landmark".
**Suggested fix**: Update or drop the trailing clause to reflect the dropdown (e.g. "...so the page has one language control").

## Nits

- ⚪ `src/components/locale-switcher.tsx:35`, the exported `LocaleSwitcher` JSDoc still says "a trigger the height of the theme pill" — true, and a nice touch, but worth double-checking after any future `ThemeToggle` sizing change since the two are now manually kept in sync via a magic `h-[34px]` rather than sharing a token.
- ⚪ `docs/specs/0004-localization/index.md:122`, the new sentence is long (three clauses); consider splitting for readability, not a content problem.

## Strengths
- The trigger height math is genuinely correct: `ThemeToggle`'s implicit height (`size-7` segment + `p-0.5` padding + 1px border, both sides) computes to exactly 34px, matching the `LocaleSwitcher`'s explicit `h-[34px]` — a careful, verified pixel match rather than an eyeballed guess.
- The `scroll-margin-top` selector list (`:target`, `input`, `select`, `textarea`, `fieldset`) is well aimed at the actual markup: the enquiry form's error-summary links (`#enquiry-companyName` etc.) target real `input`/`select` elements and a `FieldSet` (`src/features/marketing/ui/enquiry-form.tsx`), and the skip link's `#main` target is a real `:target` match — the fix genuinely addresses the described bug on the page it was written for.
- The spec updates (0003, 0004) are unusually candid about trade-offs, explicitly calling out that the dropdown drops the no-JavaScript switch path instead of glossing over it.

## Test coverage
- No test (unit or e2e) exercises the sticky/scrolled header behavior at all: `useScrolled`, the hairline appearing after 8px of scroll, or the frosted background — this is new, non-trivial browser-only logic (a scroll listener driving conditional classes) with zero coverage.
- No test asserts the theme toggle was removed from the desktop header or that it still renders in the footer/mobile sheet — one of the two headline behavior changes of this diff is untested.
- No test exercises the `scroll-margin-top` fix itself (the actual bug it was written to solve — the sticky bar covering the enquiry form's focused/scrolled error field — has no regression test), understandably hard to assert in jsdom but at least a targeted Playwright check (scroll position after a failed submit, or that the focused field's bounding box clears the header) would catch a future regression.
- The locale-switcher dropdown rewrite is well covered: `tests/shell/locale-switchers.test.tsx` exercises the new button/menu roles, keyboard open-and-arrow navigation, query preservation, `aria-current`/`lang`/`hrefLang`, and the best-effort `setLocale` failure path; `e2e/landing.spec.ts` and `e2e/localization.spec.ts` were updated in lockstep for the new roles.
