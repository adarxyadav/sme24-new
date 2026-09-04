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

### 3. Data model · done
Core entities every slice builds on: users, organizations and memberships with roles (client member, expert, ops), assessed companies, research runs and extracted safety KPIs, peer benchmarks, packages and orders, assessments and their structured answers, gap findings, expert profiles, programs and progress entries, notifications. Row level access rules are part of the model, not an afterthought, because three user types share one database.
**Done when:** entities, relationships and access rules support Slices 1 to 8 without a breaking migration, and every table is readable only by the organization or role that owns it.
spec [0002](../specs/0002-data-model/index.md) · code in `supabase/schemas/`, `supabase/tests/`, `supabase/migrations/`, `src/lib/auth/roles.ts`
- [x] Design it (spec): `/architect data model`
- [x] Build it: `/develop data model`
  - [x] Tenancy core: `private` helpers, organizations, memberships, `create_organization`, profiles extension, organization claim in the hook, seeded organizations (AC-2, AC-3, AC-6, AC-8)
  - [x] Policy test harness: pgTAP in `supabase/tests/`, `pnpm test:db`, CI database job, first migration with hand checked grants and regenerated types (AC-1, AC-7, AC-9)
  - [x] Audit log: append only table, guards, row trigger on the core tables (AC-5)
  - [x] Expert assignments and the assigned expert helper (AC-4)
  - [x] Slice 1 and 2 tables: KPI definitions, companies, research runs with transitions and realtime, company KPIs with the current view, claim helper in `roles.ts`, second migration (AC-1, AC-2, AC-3, AC-4, AC-5, AC-10)
- [x] Verify it: `/check verify data model`
- [x] Test it: `/test data model`
- [x] Review it (fresh model): `/check review data model`
- [x] Document it: `/document data model`

### 4. Design system & UI foundation · done
Visual language, layout primitives and base components for a serious B2B product: typography, color with accessible contrast, spacing, forms, tables, cards, charts styling, empty and error states. Every page in the client dashboard, admin and marketing site depends on it.
**Done when:** `design.md` covers type, color, spacing and components; base components pass keyboard, focus and screen reader checks at WCAG 2.2 AA; light and dark both render.
spec [0003](../specs/0003-design-system/index.md) · code in `src/app/globals.css`, `src/lib/contrast.ts`, `src/lib/design-tokens.ts`, `src/components/`, `src/components/shell/`, `src/components/gallery/`, `src/components/ui/`, `src/app/[locale]/admin/design/`, `docs/design.md`
- [x] Design it (spec): `/architect design system & UI foundation`
- [x] Build it: `/develop design system & UI foundation`
  - [x] Tokens, theme and the accessibility pipeline: brand and full token set in light and dark, font fix, next-themes with the toggle, gallery stub, contrast test, axe on the gallery (AC-1, AC-2, AC-3, AC-10)
  - [x] Sidebar shell and page primitives: `AppSidebar` with user menu and skip links, `PageHeader`, empty, error and loading states, toaster, responsive marketing header (AC-4, AC-5, AC-7, AC-8, AC-12)
  - [x] Component inventory and charts in the gallery: forms, data, overlays, feedback, compact table, badge levels, Recharts (AC-6, AC-8, AC-9, AC-10)
  - [x] Tests and `docs/design.md`: component and message parity tests, keyboard and mobile scenarios, the design reference (AC-10, AC-11, AC-12)
- [x] Verify it: `/check verify design system & UI foundation`
- [x] Test it: `/test design system & UI foundation`
- [x] Review it (fresh model): `/check review design system & UI foundation`
- [x] Document it: `/document design system & UI foundation`

### 5. Localization (German & English) · in-progress
Two languages from the first screen: routing per language, translated strings, number, date and CHF formatting, and translated content in generated emails and reports. Built now so French and Italian later cost only translation.
**Done when:** every user facing string is translatable, a visitor can switch between German and English and the URL reflects it, and CHF amounts and dates format per language.
spec [0004](../specs/0004-localization/index.md) · code in `src/i18n/`, `messages/`, `src/features/localization/`, `src/lib/validation.ts`, `src/proxy.ts`, `supabase/schemas/10_organizations.sql`, `docs/localization.md`, `tests/i18n/`, `e2e/localization.spec.ts`
- [x] Design it (spec): `/architect localization`
- [x] Build it: `/develop localization`
  - [x] Locale tags and formats: `de-CH` and `en-CH` behind `/de` and `/en`, the formats module in `Europe/Zurich`, the standalone translator, the missing key handling, one formatted value through the scaffold task and the gallery (AC-1, AC-3, AC-7, AC-12)
  - [x] Typed route map, switch persistence and the organisation locale: `pathnames`, the proxy on `getPathname`, the `setLocale` action, `organizations.locale` with its migration and pgTAP (AC-2, AC-9, AC-13)
  - [x] Catalog conventions and gates: shared and feature namespaces, the explicit client messages, the literal scan, typed keys, `docs/localization.md`, localised Zod messages (AC-4, AC-5, AC-6, AC-8)
  - [x] Language alternates, sitemap and English coverage in Playwright (AC-10, AC-11)
- [ ] Verify it: `/check verify localization`
- [ ] Test it: `/test localization`
- [ ] Review it (fresh model): `/check review localization`
- [ ] Document it: `/document localization`
