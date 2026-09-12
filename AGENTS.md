<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SME24

AI powered EHS consulting marketplace for regulated companies in Switzerland. One Next.js app serves the marketing site and three signed in areas (client `/app`, expert `/expert`, ops `/admin`). Product plan: `docs/scope/index.md`. Every stack decision and its reason: `docs/specs/0001-stack-architecture/index.md`.

## Stack

- **Language / Runtime**: TypeScript, strict mode plus `noUncheckedIndexedAccess`, everywhere (app, tasks, scripts); Node 22 (`.nvmrc`, `engines`)
- **Framework**: Next.js 16 App Router with React 19 Server Components; Node runtime only (no Edge), Vercel functions in `fra1`
- **Key dependencies**: Supabase in Zurich (Postgres, Auth, Storage, Realtime) through `@supabase/ssr` with RLS always on and no ORM; Trigger.dev v4 (EU) for all long running work; Tailwind v4 with shadcn/ui; next-intl v4 (`en` default, `de`); Zod v4; Sentry EU and PostHog EU; Resend with React Email for product email (Mailpit over SMTP locally); Vercel AI SDK v7 through the AI Gateway (`anthropic/claude-sonnet-5`) for every model call; Parallel Task API for company research (a fixture provider locally); Stripe (Node SDK, a restricted key) with `swissqrbill` for package checkout and QR-bill invoices.
- **Package manager**: pnpm

## Build approach

Tracer Bullet (vertical slices; each feature runs end to end through database, background jobs, API and UI, real and deployable, narrow rather than mocked). Workflow tier: GA (`/develop`, then `/check verify`, `/test`, fresh model `/check review`, `/document`).

## Commands

```bash
pnpm install                 # Node 22 via .nvmrc; Docker and the Supabase CLI are needed too
supabase start               # local Postgres, Auth, Storage, Realtime; applies migrations and seed.sql; Mailpit inbox at http://127.0.0.1:54324
pnpm dev                     # http://localhost:3000 redirects to /en (falls to 3001 when 3000 is busy)
pnpm build                   # next build
pnpm budget                  # first load JavaScript of the prerendered pages against the per page budget; exits 1 when a page is over, when the browser Sentry SDK sits in a module script, or when zod reaches a content page; `--url <deployment>` measures a deployment with VERCEL_AUTOMATION_BYPASS_SECRET (docs/marketing.md)
pnpm register:build          # rebuild src/features/marketing/register.json from the SGAS export (hand run; drops the address, phone, email and website columns before writing; commit the file)
pnpm typecheck               # next typegen + tsc --noEmit
pnpm lint / pnpm lint:fix    # Biome: lint, format, import order, a11y rules
pnpm test                    # Vitest + Testing Library (tests/, src/**/*.test.*)
pnpm test:e2e                # Playwright + axe (e2e/); starts its own dev server on port 3100, reads .env.local, 2 workers locally; the email flows go through Mailpit, so they run on the local stack only and skip on a deployment; the welcome email and research specs assert on a task only with `TRIGGER_DEV_RUNNING=1` while `pnpm trigger:dev` runs
pnpm test:db                 # pgTAP policy tests in supabase/tests/; needs the local stack running
pnpm db:diff <name>          # migration from supabase/schemas/ (declarative sync)
pnpm db:reset && pnpm db:types   # reapply locally, then regenerate src/lib/supabase/database.types.ts (CI fails when stale); never from a second worktree, they share one local stack and a reset silently skips the other's migrations
pnpm trigger:dev             # Trigger.dev tasks locally (needs a project ref; the `trigger` binary comes from the pinned `trigger.dev` dev dependency)
pnpm email:dev               # React Email preview server on port 3200, one preview per template and language (src/lib/email/previews/)
pnpm i18n:key <dotted.key|namespace>   # the value and line number of a message key in both catalogs; `--search "<text>"` finds the key by its English value. Never read messages/*.json whole, they are ~337 kB
pnpm user:invite --email <address> --role expert|ops [--locale de|en] [--name "…"]   # invite a staff user with the role fixed; needs the target environment's Supabase keys in .env.local (docs/auth.md)
pnpm users:seed [--dry-run]  # the hosted counterpart of supabase/seed.sql: the four role test accounts, confirmed, with generated passwords printed once; refuses a database holding any other user (docs/auth.md)
pnpm benchmarks:migration    # generate supabase/migrations/<timestamp>_benchmark_seed.sql from supabase/seed-data/*.csv (commit the file; then db:reset and test:db)
pnpm benchmarks:recompute    # trigger benchmark-company for every company with a snapshot; reads the target environment's Supabase and Trigger.dev keys from .env.local (docs/benchmark.md)
pnpm questionnaires:build    # rebuild src/features/assessments/content/{iso45001,compliance}.json from the raw HTML exports in the gitignored docs/raw/ (hand run; drafts the German through the AI Gateway and flags it deReviewed:false; --no-translate refuses to write unless every German is reused; commit the files)
pnpm questionnaires:migration  # render supabase/migrations/<timestamp>_questionnaire_seed.sql from the committed JSON (upserts only, never a delete, so a rerun changes no row count; commit the file)
pnpm directory:import <path-to-xlsx> [--dry-run] [--batch "<name>"]   # hand run load of the purchased contact list from a path outside the repo; refuses a hosted database until IMPORT_POLICY.status is 'cleared', prints counts only and never an address, a name or a company name (docs/directory.md)
```

## Specs

Stored in `docs/specs/`. Format: `docs/specs/NNNN-title/index.md` (decision and build plan) with `rationale.md` beside it.

## Rules

- **Functional style.** Pure functions and plain data; classes only for `Error` subclasses. Side effects (Supabase, Trigger.dev, fetch, cookies) live at the edges: `actions.ts`, `queries.ts`, `src/trigger/`, `src/lib/`. Module level values are constants; never a module level Supabase client.
- **Immutable data.** `const`, `readonly`, spread over in place mutation; `map`/`filter`/`reduce` where they read better than loops.
- **One error handling pattern.** Server actions return a typed result (`{ ok: true, data }` or `{ ok: false, error }`) and never throw for expected failures; queries throw; tasks throw so Trigger.dev retries. Unexpected errors go to Sentry; breadcrumbs use `log` from `src/lib/logger.ts` (structured JSON to stdout).
- **Validate at the boundary.** Every form and server action parses its input with the feature's Zod schema in `schema.ts`; the same schema types the form.
- **Named exports only outside `src/app/`.** Default exports only where Next.js requires them (pages, layouts, route files) and in config files.
- **Document every exported function** with a one line JSDoc: what it does and which context runs it (server component, action, proxy, task, browser).
- **Feature folders.** `src/features/<domain>/{ui/,actions.ts,queries.ts,schema.ts}`; shared infrastructure in `src/lib/`; shadcn primitives in `src/components/ui/`; routes stay thin.
- **Data access through the four client factories** in `src/lib/supabase/`, one per execution context. RLS is the real boundary; the proxy only gates areas and never redirects a server action post (a redirected POST keeps its method and lands on a page whose HTML the router cannot read as an action reply). The service client (bypasses RLS) is allowed only in `src/trigger/` and server only code, enforced by Biome; tasks take explicit ids and filter by them.
- **Database changes** start in `supabase/schemas/*.sql` (table, RLS and policies in the same file), then `pnpm db:diff`, `db:reset`, `test:db`, `db:types`. Migrations stay backward compatible (add, switch, remove later) because previews share staging. The diff misses four things that must be fixed by hand in the migration: column grants dropped by a table level `REVOKE ALL`, the `anon` execute revoke on a new `public` function, a view body rewritten from `select *` to a column list, and a view grant widened from `SELECT` to full DML for `authenticated`. Read every generated migration before committing it; the diff also re-emits unchanged functions, which are harmless but noise. Every new kind T (tenant) table copies the tenant table contract from spec 0002 and gets a pgTAP file in `supabase/tests/`.
- **A per caller `profiles` read filters by the caller's own id** (`.eq("id", claims.sub)`), never left to RLS to narrow: ops read every profile row, so an unfiltered `maybeSingle` answers an error in the ops area only (`src/components/shell/area-shell.tsx`).
- **Membership rows are never inserted directly.** Direct `INSERT` on `organization_members` is revoked for the app roles; an owner adds a member through `public.add_organization_member`, which checks the target consented. Nothing in `src/` calls it yet; feature 22 (client team invitations) does.
- **Auth** (`docs/auth.md`, spec 0005) — `src/features/auth/AGENTS.md` before any sign in, invite or auth email change.
- **Product email and ops alerts** (`docs/email.md`, spec 0006) — `src/lib/email/AGENTS.md` before adding a template, an alert kind or a transport.
- **Company research** (`docs/research.md`, spec 0007) — `src/features/research/AGENTS.md` before touching the research rail, a provider or a KPI.
- **Client entered KPIs** (`docs/benchmark.md`, spec 0010) — `src/features/self-assessment/AGENTS.md` before touching the "Your figures" card.
- **Peer benchmark** (`docs/benchmark.md`, specs 0008, 0012, 0016) — `src/features/benchmark/AGENTS.md` before any model, snapshot, peer row or derived block change.
- **Marketing site and enquiries** (`docs/marketing.md`, spec 0009) — `src/features/marketing/AGENTS.md` before touching a public page, a price or the enquiry form.
- **Package checkout and Swiss VAT** (spec 0011) — `src/features/checkout/AGENTS.md` before touching money, an order, an invoice or the Stripe webhook.
- **Expert accounts and profiles** (`docs/experts.md`, spec 0013) — `src/features/experts/AGENTS.md` before touching an invite, a status or a photo.
- **Ops admin, orders and scheduling** (spec 0014) — `src/features/ops-admin/AGENTS.md` before touching a delivery state, an assignment or a schedule action.
- **Legal, consent and data requests** (`docs/legal.md`, spec 0015) — `src/features/legal/AGENTS.md` before touching consent, a legal page, terms version or a data request.
- **Analytics and monitoring** (`docs/analytics.md`, spec 0017) — `src/lib/analytics/AGENTS.md` before adding an event, an alert or touching Sentry.
- **Contact directory** (`docs/directory.md`, spec 0018) — `src/features/directory/AGENTS.md` before touching the purchased list, credits or a reveal.
- **Structured assessments** (`docs/assessments.md`, spec 0019) — `src/features/assessments/AGENTS.md` before touching questionnaire content, an answer or scoring.
- **A server action's success work belongs in the click handler.** `submit` from `useFormAction` (`src/hooks/use-form-action.ts`) resolves with that one dispatch's result, so a toast, a `router.refresh` or closing a dialog goes in the handler that awaited it, never in a `useEffect` watching `result`: `useActionState` holds its last value for the life of the component, so such an effect re-runs on every later render and announces one write several times. Eight older consumers still use the effect shape and are a listed follow up in `docs/scope/index.md`.
- **Authenticated areas are `force-dynamic`**; static rendering only under `(marketing)`. Every user facing string goes through next-intl (`messages/de-CH.json` and `messages/en-CH.json`; the database and the URL use the short codes `de` and `en`, see `docs/localization.md`). Look a key up with `pnpm i18n:key`, never by reading a catalog whole: the two are ~337 kB together, about 90k tokens, so a read costs more than the change it serves. The app role lives in `app_metadata.role`, never a top level `role` claim.
- **Context is a budget.** The root `AGENTS.md` loads on every turn, so a rule that belongs to one area lives in that area's nested `AGENTS.md` (the pointers above) and the root keeps one line. Add a spec's prose to the nested file, not here.
- **Accessibility WCAG 2.2 AA**: Biome a11y rules in the editor, axe in Playwright as the second net. No ESLint.
- **Design system**: build all UI to `docs/design.md` (art direction, the component inventory and the build mandate); token values live in `src/app/globals.css`, and every new primitive gets a section on the ops only `/admin/design` gallery so axe scans it. No font weight anywhere goes above 600 and the three `display-*` tokens sit at 450 (owner decision of 2026-09-10): Geist carries a weight axis and no width axis, so weight is the only lever on how heavy a statement sits. `tests/font-weight.test.ts` is the gate, because the ceiling has three spellings (a Tailwind utility, a `font-[700]` arbitrary value and a raw `font-weight`/`fontWeight` declaration) and a review grep misses one; the social card is the one known exception, since `Geist-Bold.ttf` is a static 700 instance and capping it needs a 600 weight font file. The Web Interface Guidelines are a named gate under `## Interface compliance` there: run the `web-design-guidelines` skill against the files you changed before a marketing pull request, the way `pnpm budget` gates first load JavaScript. That section also records the load bearing patterns not to undo and the deliberate exceptions (sentence case over Title Case, real autocomplete tokens on the enquiry form), which are decisions rather than findings.
- **Conventional commit messages** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`).

## Tooling

Chosen by `/audit` on 2026-09-03; `/develop tooling` installs what is not yet there.
- Lint and format: Biome (installed, `biome.json`). ESLint jsx-a11y declined; Biome plus axe instead.
- Pre-commit: **lefthook** (installed, `lefthook.yml`) running Biome check on staged files plus `pnpm typecheck` on every commit, and a conventional commit message check.
- Tests: Vitest with Testing Library, Playwright with axe (both installed).
- CI: GitHub Actions (installed): `ci.yml` check and database jobs (database starts the local stack, runs pgTAP, then compares the generated types), `deploy.yml` migrate then tasks, `e2e.yml` on every Vercel deployment. Branch protection on `main` and `production` requiring `check` and `database` is still to set.

## Git

- integration: on
- branch prefix: feat/
- commit: per-milestone
- Branches: `main` deploys to staging, `production` to prod; promotion is a pull request from `main` into `production`. Push and PRs always confirm first.

## Agent skills

- [supabase](.claude/skills/supabase/): `supabase/agent-skills`, Supabase clients, SSR auth, RLS, Realtime, Storage, CLI and debugging.
- [supabase-postgres-best-practices](.claude/skills/supabase-postgres-best-practices/): `supabase/agent-skills`, load before any schema, migration, policy, index or query work.
- [vercel-react-best-practices](.claude/skills/vercel-react-best-practices/): `vercel-labs/agent-skills`, React and Next.js performance patterns for components, data fetching and bundles.
- [vercel-composition-patterns](.claude/skills/vercel-composition-patterns/): `vercel-labs/agent-skills`, component API design (compound components, render props, context).
- [deploy-to-vercel](.claude/skills/deploy-to-vercel/): `vercel-labs/agent-skills`, Vercel deployments and previews.
- [tailwind-4-docs](.claude/skills/tailwind-4-docs/): `Lombiq/Tailwind-Agent-Skills`, Tailwind v4 utilities, CSS first config, v3 to v4 gotchas.
- [playwright-skill](.claude/skills/playwright-skill/): `testdino-hq/playwright-skill`, Playwright e2e, accessibility and CI patterns.
- [vitest](.claude/skills/vitest/): `antfu/skills`, Vitest tests, mocking, fixtures, coverage.
- [trigger-tasks](.claude/skills/trigger-tasks/): `triggerdotdev/skills`, writing tasks in `src/trigger/` (task, schemaTask, retries, queues, idempotency, schedules, trigger.config.ts).
- [trigger-realtime](.claude/skills/trigger-realtime/): `triggerdotdev/skills`, showing run progress in the UI (Realtime hooks, public tokens); our default stays Supabase Realtime, so use it only for run subscriptions.
- [shadcn](.claude/skills/shadcn/): `shadcn/ui`, adding and composing shadcn components (`components.json`, preset `radix-nova`).
- [next-intl-app-router](.claude/skills/next-intl-app-router/): `liuchiawei/agent-skills`, next-intl routing, proxy, messages (community skill; spec 0001 rules win on conflicts).
- [posthog-instrumentation](.claude/skills/posthog-instrumentation/): `posthog/posthog-for-claude`, PostHog events and flags (server capture first, browser gated by consent).
- [ai-sdk](.claude/skills/ai-sdk/): `vercel/ai`, Vercel AI SDK calls, structured output, streaming (feature 8 on).
- [parallel-cli-setup](.claude/skills/parallel-cli-setup/): `parallel-web/parallel-agent-skills`, installing and authenticating the Parallel CLI (the `parallel-web` SDK behind `src/lib/research/parallel.ts`).
- [parallel-deep-research](.claude/skills/parallel-deep-research/): `parallel-web/parallel-agent-skills`, Parallel Task API research runs, processors and structured output schemas (the research provider, feature 8).
- [parallel-data-enrichment](.claude/skills/parallel-data-enrichment/): `parallel-web/parallel-agent-skills`, bulk enrichment of company lists with web sourced fields.
- [stripe-best-practices](.claude/skills/stripe-best-practices/): `stripe/ai`, Checkout, webhooks, Stripe Tax, key handling (feature 11 on).
- [resend](.claude/skills/resend/): `resend/resend-skills`, Resend API, idempotency keys, webhooks (feature 7 on).
- [react-email](.claude/skills/react-email/): `resend/resend-skills`, React Email templates (feature 7 on).
- [nodemailer](.claude/skills/nodemailer/): `aidotnet/moyucode`, Nodemailer SMTP sending (the local Mailpit transport in `src/lib/email/transport.ts`).
- [email-testing](.claude/skills/email-testing/): `petrkindlmann/qa-skills`, testing email flows through a capture inbox (Mailpit polling in Playwright, link and code extraction, deliverability checks).
- [trigger-authoring-tasks](.claude/skills/trigger-authoring-tasks/) plus `trigger-getting-started`, `trigger-realtime-and-frontend`, `trigger-cost-savings`, `trigger-authoring-chat-agent` and `trigger-chat-agent-advanced`: installed and refreshed by the `trigger.dev` CLI (the pointer block in `CLAUDE.md` is the CLI's own); they overlap with `trigger-tasks` and `trigger-realtime` above.
- [next-themes](.claude/skills/next-themes/): `pharbuz/ai-agent-skills`, theme switching with next-themes (ThemeProvider, useTheme, no flash on first paint, forced themes).
- [recharts](.claude/skills/recharts/): `andy-spike/skills`, Recharts charts behind the shadcn Chart wrapper (axes, tooltips, legends, responsive sizing, accessibility).
- [ask-sonner](.claude/skills/ask-sonner/): `emilkowalski/skills`, Sonner toasts (the single root toaster, promise and loading toasts, theming, dark mode).
- [frontend-design](.claude/skills/frontend-design/): `anthropics/skills`, art direction for new or reshaped UI (aesthetic direction, typography, choices that do not read as templated defaults); `docs/design.md` wins on conflicts.
- [web-design-guidelines](.claude/skills/web-design-guidelines/): `vercel-labs/agent-skills`, the Web Interface Guidelines, fetched fresh on every run; the named gate on marketing pages under `## Interface compliance` in `docs/design.md`, which records the deliberate exceptions and wins on conflicts.

Declined: lackeyjb/playwright-skill (same skill name as the installed one); an `exceljs` skill (`aidotnet/moyucode` and `vasilyu1983/ai-agents-public` both offer one, 12 Sep 2026), because ExcelJS is confined to the one hand run `scripts/directory-import.mts`. MCP servers: Supabase (recommended), Sentry (recommended), Stripe (recommended), PostHog (recommended), Resend (recommended, feature 7); connect them in your MCP settings, none is connected yet.

## Context files

<!-- Nested AGENTS.md files are listed here as they are created -->

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
