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
- **Key dependencies**: Supabase in Zurich (Postgres, Auth, Storage, Realtime) through `@supabase/ssr` with RLS always on and no ORM; Trigger.dev v4 (EU) for all long running work; Tailwind v4 with shadcn/ui; next-intl v4 (`en` default, `de`); Zod v4; Sentry EU and PostHog EU; Resend with React Email for product email (Mailpit over SMTP locally); Vercel AI SDK v7 through the AI Gateway (`anthropic/claude-sonnet-5`) for every model call; Parallel Task API for company research (a fixture provider locally). Later features add Stripe.
- **Package manager**: pnpm

## Build approach

Tracer Bullet (vertical slices; each feature runs end to end through database, background jobs, API and UI, real and deployable, narrow rather than mocked). Workflow tier: GA (`/develop`, then `/check verify`, `/test`, fresh model `/check review`, `/document`).

## Commands

```bash
pnpm install                 # Node 22 via .nvmrc; Docker and the Supabase CLI are needed too
supabase start               # local Postgres, Auth, Storage, Realtime; applies migrations and seed.sql; Mailpit inbox at http://127.0.0.1:54324
pnpm dev                     # http://localhost:3000 redirects to /en (falls to 3001 when 3000 is busy)
pnpm build                   # next build
pnpm typecheck               # next typegen + tsc --noEmit
pnpm lint / pnpm lint:fix    # Biome: lint, format, import order, a11y rules
pnpm test                    # Vitest + Testing Library (tests/, src/**/*.test.*)
pnpm test:e2e                # Playwright + axe (e2e/); starts its own dev server on port 3100, reads .env.local, 2 workers locally; the email flows go through Mailpit, so they run on the local stack only and skip on a deployment; the welcome email and research specs assert on a task only with `TRIGGER_DEV_RUNNING=1` while `pnpm trigger:dev` runs
pnpm test:db                 # pgTAP policy tests in supabase/tests/; needs the local stack running
pnpm db:diff <name>          # migration from supabase/schemas/ (declarative sync)
pnpm db:reset && pnpm db:types   # reapply locally, then regenerate src/lib/supabase/database.types.ts (CI fails when stale)
pnpm trigger:dev             # Trigger.dev tasks locally (needs a project ref; the `trigger` binary comes from the pinned `trigger.dev` dev dependency)
pnpm email:dev               # React Email preview server on port 3200, one preview per template and language (src/lib/email/previews/)
pnpm user:invite --email <address> --role expert|ops [--locale de|en] [--name "…"]   # invite a staff user with the role fixed; needs the target environment's Supabase keys in .env.local (docs/auth.md)
pnpm benchmarks:migration    # generate supabase/migrations/<timestamp>_benchmark_seed.sql from supabase/seed-data/*.csv (commit the file; then db:reset and test:db)
pnpm benchmarks:recompute    # trigger benchmark-company for every company with a snapshot; reads the target environment's Supabase and Trigger.dev keys from .env.local (docs/benchmark.md)
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
- **Data access through the four client factories** in `src/lib/supabase/`, one per execution context. RLS is the real boundary; the proxy only gates areas. The service client (bypasses RLS) is allowed only in `src/trigger/` and server only code, enforced by Biome; tasks take explicit ids and filter by them.
- **Database changes** start in `supabase/schemas/*.sql` (table, RLS and policies in the same file), then `pnpm db:diff`, `db:reset`, `test:db`, `db:types`. Migrations stay backward compatible (add, switch, remove later) because previews share staging. The diff misses three things that must be re-added by hand in the migration: column grants dropped by a table level `REVOKE ALL`, the `anon` execute revoke on a new `public` function, and a view body rewritten from `select *` to a column list. Every new kind T (tenant) table copies the tenant table contract from spec 0002 and gets a pgTAP file in `supabase/tests/`.
- **Membership rows are never inserted directly.** Direct `INSERT` on `organization_members` is revoked for the app roles; an owner adds a member through `public.add_organization_member`, which checks the target consented. Nothing in `src/` calls it yet; feature 22 (client team invitations) does.
- **Auth flows follow `docs/auth.md`** (spec 0005). Every emailed link goes through `/api/auth/confirm` and is verified from its token hash (never `{{ .ConfirmationURL }}` in a template); `profiles.terms_accepted_at` is written only by the profiles trigger or `accept_terms()`; the role never comes from user input (the profiles trigger defaults to `client`, only `pnpm user:invite` sets `expert` or `ops`). Auth email templates live in `supabase/templates/` (German above English) and the hosted settings (Resend SMTP, templates, Google and Microsoft) are a per environment checklist in `docs/auth.md`.
- **Product email and ops alerts follow `docs/email.md`** (spec 0006). Every product email goes through `sendEmail` in `src/lib/email/send.ts`, which triggers the `send-email` task: one `email_deliveries` row per send, a React Email template from the registry rendered in the recipient's stored language, Resend when `RESEND_API_KEY` is set, else SMTP through `EMAIL_SMTP_URL` (Mailpit locally), else `skipped`; never call a transport directly. Team alerts go through `sendOpsAlert` in `src/lib/alerts/` and the `ops-alert` task to the Slack webhook. A new template is a schema entry, a component, a registry entry, `email.<name>` keys in both catalogs and a preview; a new alert kind is a schema plus a presenter. Auth emails stay on the Supabase path in `docs/auth.md`. Ops watch deliveries on `/admin/emails`; the per environment checklist (domain, keys, webhook, allowlist, Slack) lives in the runbook.
- **Company research follows `docs/research.md`** (spec 0007). `requestResearch` in `src/features/research/actions.ts` inserts the company and a `queued` run and triggers the `research-company` task under the idempotency key `research/<runId>`; the database holds the guards (one open run per company, five runs per organization per rolling 24 hours), never the app. Providers implement the interface in `src/lib/research/provider.ts` (Parallel and the fixture are interchangeable; a second provider is a file in that folder); `RESEARCH_PROVIDER` is `fixture` whenever `PARALLEL_API_KEY` is empty and a deployed task without the key refuses to start. Every model call goes through `structuredOutput` in `src/lib/ai/gateway.ts` (AI SDK v7 through the AI Gateway, prompts versioned in `src/lib/ai/prompts/`); nothing else imports `ai`. A new KPI is a `kpi_definitions` seed row plus a catalogue entry in `src/features/research/catalogue.ts` (a Vitest test keeps them equal); a new error code is a `research_runs.error_code` value plus `research.errors.<code>` keys in both catalogs. The per environment checklist (Parallel key, gateway key, schedule, Slack, spike, firewall) lives in the runbook.
- **Peer benchmark follows `docs/benchmark.md`** (spec 0008). The `benchmark-company` task runs after a research run ends `succeeded` (key `benchmark/run/<runId>`), after `updateCompanyFacts` in `src/features/benchmark/actions.ts` (key `benchmark/edit/<companyId>/<updated_at>`) and on `pnpm benchmarks:recompute`; it hands stored rows to the pure `computeBenchmark` in `src/features/benchmark/model.ts` and inserts one immutable `benchmark_snapshots` row (written only by the service role), which the dashboard reads through the version keyed `SNAPSHOT_SCHEMAS` in `snapshot.ts`; no model call anywhere. A formula change bumps `MODEL_VERSION` in `src/features/benchmark/catalogue.ts` and adds a schema to the map, never rewrites old rows. Peer values and the seven assumptions live in `supabase/seed-data/*.csv` and reach the database only through `pnpm benchmarks:migration`; every first seed row is `provisional`, and the launch gate in the runbook requires zero provisional rows in production.
- **Client entered KPIs follow `docs/benchmark.md`** (spec 0010). The "Your figures" card in `src/features/self-assessment/` writes the same `company_kpis` table as research with `source 'client'`: `saveClientKpis` reads then writes (the client unique index is partial, so PostgREST cannot upsert onto it) and `clearClientKpi` deletes one row so the research value shows again; both queue `benchmark-company` with `triggerKind 'client_edit'` under `benchmark/kpis/<companyId>/<moment>` and `benchmark/kpis-clear/<rowId>`, and both answer a typed result, never throw. Every hand entered value belongs to one reporting year from the pure rules in `years.ts` (`currentYear` reads the server clock in `Europe/Zurich`); the form parses with the `clientKpisFormSchema(currentYear)` factory and sends only the fields the client changed, so an untouched research value is never copied into a client row. Strings live in the `selfAssessment` namespace in both catalogs. The update and delete policies are per creator until feature 22 relaxes them to organization scope.
- **Authenticated areas are `force-dynamic`**; static rendering only under `(marketing)`. Every user facing string goes through next-intl (`messages/de-CH.json` and `messages/en-CH.json`; the database and the URL use the short codes `de` and `en`, see `docs/localization.md`). The app role lives in `app_metadata.role`, never a top level `role` claim.
- **Accessibility WCAG 2.2 AA**: Biome a11y rules in the editor, axe in Playwright as the second net. No ESLint.
- **Design system**: build all UI to `docs/design.md` (art direction, the component inventory and the build mandate); token values live in `src/app/globals.css`, and every new primitive gets a section on the ops only `/admin/design` gallery so axe scans it.
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

Declined: lackeyjb/playwright-skill (same skill name as the installed one). MCP servers: Supabase (recommended), Sentry (recommended), Stripe (recommended), PostHog (recommended), Resend (recommended, feature 7); connect them in your MCP settings, none is connected yet.

## Context files

<!-- Nested AGENTS.md files are listed here as they are created -->

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
