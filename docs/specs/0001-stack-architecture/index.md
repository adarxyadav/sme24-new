# 0001. Stack and architecture for SME24

**Date**: 2026-09-02
**Status**: In Progress

## Summary

SME24 is one Next.js web application on Vercel, with Supabase (a hosted Postgres database with built in auth, file storage and live updates) in Zurich as the single source of truth, Trigger.dev (a hosted background job runner) in Frankfurt for every long running piece of work, and the Vercel AI SDK routing all AI calls to Claude Sonnet 5 through the AI Gateway. One codebase serves the marketing site and the three user areas (client, expert, ops), with row level security in the database deciding who sees what. This spec records those choices, the boundaries between web app, jobs and AI, the regions, the environments, and the smaller tool and setup picks the scaffold starts on. The scaffold sub task of scope feature 1 turns it into a runnable skeleton; every later feature spec builds on it.

## Requirements

This is a decision spec, so there is no build plan here; the scaffold sub task of scope feature 1 derives its steps from `## Proposed stack` and `## Architecture` at `/develop` time. These light criteria are what `/check verify` checks on that scaffold. They describe the runnable skeleton, not this document.

**User stories**:
- As the engineer, I want an empty but real skeleton of the whole stack so that every later feature is a folder, a task and a migration on top of it, not a setup project.
- As the ops team, I want the skeleton to already deploy along the staging and production paths so that the first real feature ships the same way the last one will.

**Acceptance criteria**:
- **AC-1**: The scaffold boots locally with the documented sequence (`pnpm install`, `supabase start`, `pnpm dev`, `pnpm dlx trigger.dev@latest dev`) and renders a localized page at `/de` and `/en`, with `/` redirecting to `/de`.
- **AC-2**: Typecheck, Biome lint and format check, and the Vitest suite run clean locally and in the GitHub Actions workflow on every pull request into `main` and into `production`.
- **AC-3**: Merging to `main` deploys the app to the staging alias, applies migrations to the staging Supabase project and deploys tasks to the Trigger.dev staging environment; on that alias a task can be triggered and writes a row the page shows. Pull request previews use the same staging database and tasks (a one time manual staging deploy of tasks precedes the first pull request).
- **AC-4**: The first migration comes from the declarative schema, enables RLS on every table it creates, and the checked in generated TypeScript types match the schema in CI.
- **AC-5**: Supabase Auth sessions, a `role` claim in the access token, and a role check in the request proxy exist end to end: with the seeded users, each of `/app`, `/expert` and `/admin` rejects a user without the matching role.
- **AC-6**: Sentry receives a test error from the server and from a task, and PostHog receives a server side test event, both in their EU regions.
- **AC-7**: Every variable in `.env.example` is validated by the env module in the context that needs it (browser, server, task), and a missing required variable fails with a clear message.
- **AC-8**: A Playwright test with axe assertions runs against the deployment URL in CI and passes on the localized landing page.

## Decision

**Chosen option**: Option 1: Next.js on Vercel, Supabase, Trigger.dev, AI SDK with AI Gateway (the stack you named, now pinned with regions, boundaries and the finer picks).

One single repo, single Next.js 16 App Router app in TypeScript, deployed on Vercel (functions in Frankfurt), with Supabase in Zurich for Postgres, auth, storage and realtime, Trigger.dev v4 cloud in the EU region for background work, the Vercel AI SDK v6 through the AI Gateway on Claude Sonnet 5, Parallel Task API for company research, Stripe for payments, Resend for email, Sentry (EU) and PostHog (EU) for observability and analytics, next-intl for German and English.

**Implementation skills**: `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `vercel-react-best-practices` (`vercel-labs/agent-skills`, `.claude/skills/vercel-react-best-practices/`) · `vercel-composition-patterns` (`vercel-labs/agent-skills`, `.claude/skills/vercel-composition-patterns/`) · `deploy-to-vercel` (`vercel-labs/agent-skills`, `.claude/skills/deploy-to-vercel/`) · `tailwind-4-docs` (`Lombiq/Tailwind-Agent-Skills`, `.claude/skills/tailwind-4-docs/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Proposed stack

Every row is a decision. Where a later feature spec owns the detail, the row says so.

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict mode, everywhere (app, tasks, scripts) | One language for UI, server, jobs and schema types; strict mode catches the null and shape bugs that show up at 3am. |
| Framework | Next.js 16 App Router, React Server Components | Server rendering for the marketing site (SEO) and the dashboards from one framework; first class on Vercel. |
| Repo shape | Single repo, single app, Trigger.dev tasks in `src/trigger/` inside it, `trigger.config.ts` at the repo root | Team of one or two; shared types between app and tasks with no workspace plumbing. |
| App structure | One app: the `(marketing)` route group at the root of the locale segment, plus three real path segments `/app` (clients), `/expert`, `/admin` (ops), all under `[locale]`; `api` sits outside `[locale]` | One deploy, one session, the proxy matches on the path prefix, shared design system. |
| UI | Tailwind CSS v4 (CSS first config) with shadcn/ui components copied into `src/components/ui/` | Accessible primitives you own and can restyle; feature 4 defines the visual language on top. |
| Primary database | Supabase Postgres, region Zurich (`eu-central-2`) | Relational data with strong constraints; data physically in Switzerland for the privacy policy and pilot contracts. |
| Data access | Supabase JS client on `@supabase/ssr` with RLS (per row access rules in the database) always on; four client factories, one per execution context (see Architecture); TypeScript types generated from the schema | Three user types share one database; RLS is the one place access is decided, every user facing query runs as the signed in user. |
| Schema and migrations | Supabase CLI declarative schema: SQL files under `supabase/schemas/`, diffed into `supabase/migrations/`; `supabase/config.toml` and `supabase/seed.sql` checked in | Tables, policies, functions and triggers live together in SQL and run identically locally, on staging and in prod. |
| Auth | Supabase Auth with cookie sessions; the user's `role` (client, expert, ops) lives in `app_metadata` and is added to the access token by a custom access token hook (a Postgres function), so the proxy reads it from the session claims with no database call | Already in the stack; `auth.uid()` and the role claim flow straight into RLS. Sign in methods and the organization model are feature 6's spec. |
| Background jobs | Trigger.dev v4 cloud, EU region (Frankfurt), tasks in `src/trigger/` | Retries, logs, run ids and long durations for the research pipeline, AI generation, report rendering and email sends. |
| AI | Vercel AI SDK v6 through the Vercel AI Gateway with an explicit `AI_GATEWAY_API_KEY` in every environment (tasks have no Vercel identity), model `anthropic/claude-sonnet-5`, structured outputs with Zod schemas | One module for all model calls; the gateway handles retries and usage; structured outputs keep extraction typed. |
| Company research | Parallel Task API, called from a Trigger.dev task | Web research with sources, run durably inside a task so it can take minutes and be retried. Pipeline shape is feature 8's spec. |
| Payments | Stripe (Node SDK). Pattern: a webhook route handler verifies the signature, records the event id in an events table so redeliveries are ignored, enqueues a task, returns 200 | Swiss VAT, receipts and hosted checkout. The handler, its events table, checkout mode, VAT handling and order states land in feature 11, not the scaffold. |
| Email | Resend with React Email templates, EU sending region | Templates are React components localized with the app's strings; send calls run inside Trigger.dev tasks. Templates and triggers are feature 7's spec. |
| File storage | Supabase Storage, private buckets, signed URLs, RLS on `storage.objects` | Object storage in Zurich beside the data it belongs to; never files in the database. |
| Realtime | Supabase Realtime (Postgres changes, RLS enforced on the realtime publication) for job progress, polling a server component as fallback | The database stays the single source of truth; the browser never talks to Trigger.dev directly. |
| Localization | next-intl v4: locale prefix always (`/de`, `/en`), default `de`, browser language detection off, `/` redirects to `/de`, an explicit switcher writes the locale cookie, messages in `messages/<locale>.json` | Deterministic URLs for SEO and tests; works in server components, actions and tasks. Content rules are feature 5's spec. |
| Forms and validation | React Hook Form with Zod, via the shadcn Form components; the same Zod schemas validate every server action | One schema per form, validated on both sides. |
| Client data fetching | Server Components for reads, no client fetch library until a screen needs live refetching (then TanStack Query, scoped to that screen) | Keeps the client bundle small and the data path simple. |
| API shape | Server Components for reads, Server Actions for mutations, Route Handlers only for machine endpoints (webhooks, health, sitemap, robots), all unlocalized under `/api` | The native Next.js model with the least code; no public API in Release 1 (deferred). |
| Caching | Authenticated areas fully dynamic (`dynamic = 'force-dynamic'` on the `/app`, `/expert`, `/admin` layouts, the new cache components mode off); static rendering only under `(marketing)` | Per user pages must never be served from a shared cache; marketing pages want static rendering for SEO. |
| Hosting | Vercel, Node.js runtime on Fluid compute for functions and for the request proxy, Functions region Frankfurt (`fra1`) set in project settings, no Edge runtime | Supabase SSR, Sentry and the AI SDK all favor Node; Frankfurt is the closest region to Zurich. |
| Error monitoring | Sentry, EU data region, `@sentry/nextjs` in the app plus the Sentry build extension and an init hook in `trigger.config.ts` | Frontend, server and task errors in one place with source maps and alert routing. Event taxonomy is feature 15's spec. |
| Product analytics | PostHog EU Cloud (Frankfurt): `posthog-node` on the server with the project key for the funnel, `posthog-js` in the browser gated by cookie consent | Funnels and flags in one EU hosted tool; the core funnel does not depend on consent because it is captured on the server. |
| Logging | Structured JSON to stdout (Vercel logs, Trigger.dev run logs); no separate log vendor | Enough for one or two people; Sentry carries the errors. |
| Cache and search services | None; Postgres full text search if the admin ever needs it | No measured need; every extra service is a new failure mode. |
| Rate limiting | Vercel Firewall rate limit rules on the public Next.js endpoints (company lookup, enquiry form, webhooks) plus per organization quotas for research runs stored in Postgres; Supabase Auth applies its own limits to sign in calls, which go to Supabase directly | Abuse protection without a new vendor. |
| Package manager and runtime | pnpm, Node 22 LTS pinned in `.nvmrc` and `engines` | Fast, strict about phantom dependencies, first class on Vercel and Trigger.dev. |
| Lint and format | Biome (one config for lint and format) with its accessibility rule group enabled | Runs in milliseconds; its accessibility rules cover less than the ESLint plugin, so axe in Playwright is the second net (see Consequences). |
| Tests | Vitest with React Testing Library for unit and component tests, Playwright for end to end, axe-core assertions through Playwright for WCAG 2.2 AA | Fast unit loop, real browser for the tracer bullet slices and `/check verify`. |
| Git and CI | GitHub with GitHub Actions (jobs listed under Architecture); Vercel and Trigger.dev deploy from GitHub | Both platforms integrate with GitHub natively; free for a small private repo. |
| Environments | Local Supabase (CLI, Docker) for dev; one staging Supabase project and Trigger.dev environment for `main` and pull request previews; a prod project and environment for the `production` branch | Three fixed environments, cheap and predictable; no per branch database costs. |
| Secrets and config | Vercel environment variables per scope (Development, Preview, Production; pulled locally with `vercel env pull`), Trigger.dev environment variables per environment, one `src/lib/env.ts` module with three Zod schemas (browser, server, task) parsed lazily on first access | Missing or malformed config fails at the first access in the context that needs it, with a clear message, and never crashes a context that does not. |

## Architecture

**Pattern.** A layered monolith: routes are thin, each domain owns its UI, actions and queries in one folder, shared infrastructure sits in `src/lib/`, and long running work is a task in the same repo. Nothing is split into a service until a measured bottleneck or a team boundary forces it.

**Source layout.**

```
trigger.config.ts                      Trigger.dev v4 config, dirs: ['./src/trigger'], Sentry extension
supabase/config.toml                   local ports, site_url, preview redirect wildcard, auth hook
supabase/schemas/ + supabase/migrations/ + supabase/seed.sql
src/proxy.ts                           request proxy (Next.js 16's name for middleware), Node runtime
src/app/[locale]/(marketing)/...       public pages, static rendering
src/app/[locale]/app/...               client area (force-dynamic)
src/app/[locale]/expert/...            expert area (force-dynamic)
src/app/[locale]/admin/...             ops area (force-dynamic)
src/app/api/...                        route handlers: health, sitemap, robots, later webhooks
src/features/<domain>/                 ui, actions, queries, schemas per domain
                                       (research, benchmark, orders, assessments, programs, ...)
src/components/ui/                     shadcn/ui primitives
src/components/                        shared app components
src/lib/supabase/server.ts             createServerClient(): server components, cookies read only
src/lib/supabase/action.ts             createActionClient(): server actions and route handlers, cookies writable
src/lib/supabase/proxy.ts              createProxyClient(): the request proxy, returns the mutated response
src/lib/supabase/client.ts             createBrowserClient(): browser singleton
src/lib/supabase/service.ts            createServiceClient(): secret key, no session, 'server-only', tasks and admin code
src/lib/supabase/database.types.ts     generated types, checked in
src/lib/ai/                            AI SDK model + helpers, prompts versioned in code
src/lib/email/                         Resend client, React Email templates
src/lib/analytics/                     PostHog server capture, consent aware client init
src/lib/env.ts                         clientEnv, serverEnv, taskEnv (Zod, lazy)
src/i18n/ + messages/<locale>.json     next-intl config and strings
src/trigger/                           Trigger.dev tasks (research, generation, email sends)
tests/ (vitest), e2e/ (playwright)
```

Never a module level Supabase client: each request or task creates its own through the matching factory.

**Where each kind of work runs.**

| Work | Runs in | Why |
|---|---|---|
| Page render, form submit, small reads and writes | Next.js server components and server actions on Vercel | Request scoped, seconds at most. |
| Anything long, multi step or that must retry: research pipeline, AI generation, gap report rendering, every email send | Trigger.dev task | Durable retries, logs, a run id the UI can show, no function timeout. |
| Short interactive AI calls (a rewrite, a suggestion the user waits for) | Server action calling the AI SDK | Only when the user is waiting and the call is well under the function limit; anything else is a task. |
| Stripe and other inbound webhooks (from feature 11) | Route handler: verify signature, record the event id idempotently, enqueue a task, return 200 | Keeps the webhook fast and safe to redeliver. |
| Scheduled work (reconciliation, digests) | Trigger.dev scheduled tasks | One scheduler, same logs and retries. |

**Request and job flow, in words.** A signed in user's request carries the Supabase session cookie. The request proxy runs on the Node runtime, refreshes the session through the proxy client, reads the `role` claim from the access token and rejects users whose role does not match the area (`/app` needs `client`, `/expert` needs `expert`, `/admin` needs `ops`). Its matcher skips `/api`, `/_next`, `/_vercel` and any path with a file extension, so machine endpoints are never localized or redirected. The proxy only gates areas; RLS remains the real boundary. Server components read through the server client as that user, so RLS applies. A server action validates its input with the feature's Zod schema, writes through the action client, and where the work is long it triggers a task with `tasks.trigger()` and stores the run id and a `queued` status on the row the UI watches, with the organization id set at insert time. The task runs in Frankfurt with the service client, writes progress and results back to Postgres as it goes, and the dashboard receives those row changes through Supabase Realtime, authorized against the subscriber's SELECT policies. If the realtime channel fails, the page polls a server component every few seconds.

**Realtime rules (scaffold level).** RLS is enabled on the `supabase_realtime` publication; each table that emits changes is added to the publication explicitly in a migration; the browser client calls `realtime.setAuth()` with the access token after sign in and on every refresh; and a row must carry the organization id the subscriber's policy checks at insert time, or the subscriber receives nothing for it.

**Environments, branches and CI.**

| Branch or place | Vercel | Supabase | Trigger.dev |
|---|---|---|---|
| Local | `next dev` | local stack via `supabase start` | `trigger.dev dev` |
| Pull request | preview deployment (Preview scope env vars) | staging project | staging environment (tasks are `main`'s code) |
| `main` | preview deployment; the `staging.<domain>` domain is assigned to the `main` branch in Vercel's domain settings | staging project, migrations applied by CI on push | staging environment, deployed by CI on push |
| `production` | production deployment; Vercel's production branch setting is changed from the default to `production` | prod project, migrations applied by CI on push | prod environment, deployed by CI on push |

GitHub Actions jobs:
- `check` on `pull_request` into `main` and `production`, and on `push` to both: typecheck, Biome (`biome ci`), Vitest.
- `types` in the same workflow: `supabase start`, `supabase gen types typescript --local`, diff against the checked in file, fail on difference.
- `migrate` on `push` to `main` (secret `STAGING_SUPABASE_DB_URL`) and to `production` (secret `PROD_SUPABASE_DB_URL`): `supabase db push --db-url ...`, ordered before the deploy hook. The backward compatible migration rule (add, then switch, then remove in a later change) keeps either ordering safe.
- `tasks` on the same pushes: `pnpm dlx trigger.dev@latest deploy --env staging` or `--env prod`, authenticated with the repo secret `TRIGGER_ACCESS_TOKEN` (a personal access token, not the runtime secret key).
- `e2e` on the `deployment_status` event: reads the deployment URL from the event into `PLAYWRIGHT_BASE_URL` and runs Playwright with axe against it.

Branch protection on `main` and `production` requires a pull request and the `check` job (feature 2). Promotion to production is a pull request from `main` into `production`.

**Security model.** Compliance scope: revised Swiss FADP with GDPR readiness for EU clients, and WCAG 2.2 AA (feature 14 and feature 4 carry the detail). Every user facing table carries an organization id, every table has RLS enabled from its first migration with policies for the three roles (client member scoped to their organization, expert scoped to assigned work, ops with elevated but logged access), written the way the installed Supabase skill prescribes (`to authenticated` plus an ownership predicate, `using` and `with check` on updates, authorization claims in `app_metadata` never `user_metadata`). The scaffold's first migration creates a minimal `profiles` table (user id, role, organization id, self select policy) and the custom access token hook, plus seed users for the three roles in `supabase/seed.sql`; feature 3 extends this model rather than replacing it. The service client holds the secret key and exists only in `src/trigger/` and server only admin code, never in the browser; tasks bypass RLS, so every task takes explicit ids and filters by them rather than querying broadly. Only `NEXT_PUBLIC_` variables reach the browser: the Supabase URL and publishable key, the PostHog key and host, and the Sentry DSN. Error payloads go to Sentry's EU region; analytics to PostHog's EU region; email content and AI prompts cross to US providers under their data processing agreements, which the privacy policy states (feature 14). An audit log table (who did what, when, to which row) is part of the data model in feature 3, not optional. Public Next.js endpoints are rate limited at the Vercel Firewall.

**Configuration required.** The scaffold creates `.env.example` with every key, each marked `required` or `optional (feature N)`; values live in Vercel per scope and in Trigger.dev per environment. Supabase's current publishable and secret key names are used (the legacy `anon` and `service_role` names are equivalents, not preferred).
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (required, browser and server clients)
- `SUPABASE_SECRET_KEY` (required in Trigger.dev and server only code, never `NEXT_PUBLIC_`)
- `STAGING_SUPABASE_DB_URL`, `PROD_SUPABASE_DB_URL` (GitHub repo secrets for the migrate job)
- `TRIGGER_SECRET_KEY` (required, the runtime key per environment: the staging key in Vercel's Preview scope, the prod key in Production), `TRIGGER_PROJECT_REF` (required), `TRIGGER_ACCESS_TOKEN` (GitHub repo secret for deploys)
- `AI_GATEWAY_API_KEY` (required in Vercel and Trigger.dev; no OIDC fallback)
- `PARALLEL_API_KEY` (optional until feature 8)
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (optional until feature 11)
- `RESEND_API_KEY`, `EMAIL_FROM` (optional until feature 7; set in Trigger.dev, where sends run)
- `SENTRY_DSN` (required, in Vercel and in every Trigger.dev environment), `NEXT_PUBLIC_SENTRY_DSN` (required), `SENTRY_AUTH_TOKEN` (build time source maps, CI and Vercel build only)
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (`https://eu.i.posthog.com`) (required); the server uses the same project key, there is no separate server key
- `NEXT_PUBLIC_APP_URL` (required: absolute URLs in emails, sitemap and Stripe redirects)

## Consequences

**Positive**:
- One language, one repo, one deploy; a feature is a folder plus a task plus a migration, which matches the Tracer Bullet slices in the scope.
- Access control for user facing code lives in one place (RLS), so a bug in a server action cannot leak another organization's rows.
- Long running work never fights a function timeout, and every pipeline run has a durable id, logs and retries from day one.
- Data at rest is in Switzerland; errors and analytics stay in the EU; the residency story is short and defensible.
- Everything is managed; nobody on the team operates a server, a queue or a database.

**Negative / tradeoffs**:
- Four hosted vendors carry your data or traffic (Vercel, Supabase, Trigger.dev, plus Anthropic through the AI Gateway) and three more see fragments (Resend, Sentry, PostHog). Each needs a signed data processing agreement and a line in the privacy policy, and email content and AI prompts do cross to the US.
- Tasks hold the secret key and bypass RLS, so a careless task query can leak across organizations where a server action cannot. The explicit ids rule and code review are the only guards; feature 3's policy tests do not cover tasks.
- RLS policies are SQL you must test; a wrong policy is silent (rows just vanish or appear). Feature 3 must ship policy tests, not just policies.
- Biome's accessibility rules cover less than the ESLint accessibility plugin, so some mistakes surface in Playwright with axe rather than in the editor. If that proves too late, add ESLint with only the accessibility plugin beside Biome (feature 2 decides).
- Shared staging for previews means schema changes must be backward compatible in every pull request, two open pull requests can interfere with each other's data, and a preview always runs `main`'s tasks, not the pull request's.
- Sign in on a preview only works because the staging Supabase project allows a wildcard redirect URL for Vercel preview hosts; forgetting it breaks every preview's auth.
- Supabase Realtime evaluates RLS per subscriber per change; fine for pilots, worth watching if hundreds of clients keep dashboards open (polling is the ready fallback).
- Next.js 16 and Tailwind v4 are current majors; some third party examples and shadcn snippets still target the previous ones, so expect small adaptations.

**Neutral**:
- The AI model is swappable through the gateway (a model string change) without touching call sites. Whether the gateway can pin an EU region for Claude is not established; see Follow-up.
- Role claims in the access token are only as fresh as the token; a role change takes effect at the next refresh, and RLS decides the rest.
- Trunk based flow with a `production` branch is a convention the team keeps through branch protection (feature 2).

## Follow-up

- [ ] Feature 2 (`/audit`, then `/develop tooling`): capture these conventions in root `AGENTS.md` (including the `## Agent skills` bullets for the seven installed skills and the MCP servers line), set branch protection on `production` and `main`, wire the GitHub Actions jobs above, and decide whether the ESLint accessibility plugin joins Biome.
- [ ] Connect the MCP servers you chose (Supabase, Sentry, Stripe, PostHog, all official) in your MCP settings; the Supabase skill documents its hosted endpoint and OAuth flow. Their tools are used automatically once connected. Declined or not found: a second Playwright skill (`lackeyjb/playwright-skill`) could not be installed beside the chosen one because both use the same skill name; no Biome skill exists under the names the registry search returned, so Biome conventions come from its docs.
- [ ] Feature 3 (data model): every table gets an organization id and RLS from the first migration, extends the scaffold's `profiles` table and access token hook (adding the organization id claim), and ships the audit log table and policy tests.
- [ ] Feature 14 (legal): sign or accept the data processing agreements for Vercel, Supabase, Trigger.dev, Anthropic (via Vercel AI Gateway), Parallel, Stripe, Resend, Sentry and PostHog, and list them in the privacy policy with regions.
- [ ] Decide the production domain and the `staging.` alias before feature 13 (marketing site) so absolute URLs, Stripe redirects and email links are stable.
- [ ] Verify before the scaffold the items the landscape check could not confirm today: PostHog EU and Sentry EU region status, Biome's current major and its rule groups, and the Vercel Frankfurt region name.
- [ ] Consider proxying PostHog through a Next.js rewrite so ad blockers do not drop consented client events (feature 15).
- [ ] If pilot contracts demand that AI processing stays in the EU, investigate whether the AI Gateway can pin an EU region on Bedrock or Vertex for Claude; if not, the AI module swaps to a direct Bedrock or Vertex provider, which is a change inside `src/lib/ai/` only.

## Rationale

Reasoning, options considered, the landscape check evidence, the cross check record and references: see [rationale.md](rationale.md).
