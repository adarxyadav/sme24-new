# Foundations · SME24

Part of the [SME24 scope](index.md). Everything the slices stand on. Build these in order; cheaper ground before what depends on it.

## Foundation

### 1. Stack & architecture · in-progress
You have already named the stack (Next.js 16 App Router, TypeScript, Tailwind v4 with shadcn/ui, Supabase, Trigger.dev v4, Vercel AI SDK v6 with AI Gateway on Claude Sonnet 5, Parallel Task API, Stripe, Vercel). The spec records that decision, the three user types, the boundary between web app, background jobs and AI calls, hosting region for Swiss data, and any style preferences you hold. Then the scaffold makes it a runnable skeleton.
**Done when:** the stack and architecture are recorded in a spec, and the empty scaffold boots locally, builds clean, and deploys to a preview environment.
spec [0001](../specs/0001-stack-architecture/index.md) · code in `src/`, `supabase/`, `.github/workflows/`, `trigger.config.ts`
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
  - [x] App skeleton: Next.js 16, next-intl (`/` → `/de`), env module, Biome, Vitest
  - [x] Supabase: declarative schema, first migration applied, RLS, role hook, seeded users, generated types, proxy role gate
  - [x] Trigger.dev task, Sentry and PostHog wiring, ops smoke test page with Realtime + polling
  - [x] GitHub Actions (check, types, migrate, tasks, e2e), Playwright + axe, README boot sequence
- [ ] Verify it: `/check verify stack & architecture`
- [ ] Test it: `/test stack & architecture`
- [ ] Review it (fresh model): `/check review stack & architecture`
- [ ] Document it: `/document stack & architecture`

### 2. Coding standards & tooling · done
Capture conventions and tooling choices from the real scaffolded project into root `AGENTS.md`, then install lint, format, strict types, `pre-commit` hooks and CI so every later feature follows them.
**Done when:** root `AGENTS.md` reflects the real stack and conventions, and lint, format, typecheck and `pre-commit` run clean locally and in CI.
spec [0001](../specs/0001-stack-architecture/index.md) · code in `lefthook.yml`, `scripts/check-commit-message.mts`, `biome.json`, `.github/workflows/ci.yml`
- [x] Capture conventions + tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test tooling`

### 3. Data model · needs a decision
Core entities every slice builds on: users, organizations and memberships with roles (client member, expert, ops), assessed companies, research runs and extracted safety KPIs, peer benchmarks, packages and orders, assessments and their structured answers, gap findings, expert profiles, programs and progress entries, notifications. Row level access rules are part of the model, not an afterthought, because three user types share one database.
**Done when:** entities, relationships and access rules support Slices 1 to 8 without a breaking migration, and every table is readable only by the organization or role that owns it.
- [ ] Design it (spec): `/architect data model`

### 4. Design system & UI foundation · needs a decision
Visual language, layout primitives and base components for a serious B2B product: typography, color with accessible contrast, spacing, forms, tables, cards, charts styling, empty and error states. Every page in the client dashboard, admin and marketing site depends on it.
**Done when:** `design.md` covers type, color, spacing and components; base components pass keyboard, focus and screen reader checks at WCAG 2.2 AA; light and dark both render.
- [ ] Design it (spec): `/architect design system & UI foundation`

### 5. Localization (German & English) · needs a decision
Two languages from the first screen: routing per language, translated strings, number, date and CHF formatting, and translated content in generated emails and reports. Built now so French and Italian later cost only translation.
**Done when:** every user facing string is translatable, a visitor can switch between German and English and the URL reflects it, and CHF amounts and dates format per language.
- [ ] Design it (spec): `/architect localization`
