# 0001. Stack and architecture for SME24: rationale

Decision record for [index.md](index.md). Read by people and by `/architect` on update or supersede, not during a build.

## Context

SME24 is an AI powered EHS consulting marketplace for regulated companies in Switzerland: a company benchmarks its EHS risk for free, sees the annual cost of incidents in CHF, then buys a fixed price package that pairs it with a senior expert. Three kinds of people use it (client organizations with several members, invited EHS experts, the internal ops team), in German and English from day one. Release 1 (the free funnel plus paid checkout) is due within three months for waiting pilot clients, built by a team of one or two.

The stack was named before this spec (Next.js 16, TypeScript, Tailwind v4 with shadcn/ui, Supabase, Trigger.dev v4, Vercel AI SDK v6 with the AI Gateway on Claude Sonnet 5, Parallel Task API, Stripe, Vercel). What was open: where Swiss company and contact data may live and be processed, where the boundary runs between the web app, background jobs and AI calls, how three user types and a marketing site fit in one product, how the app talks to the database when three roles share it, and the finer picks the scope never named (email, monitoring, analytics, localization library, tooling, environments, CI).

Forces: the core thread is a background research pipeline that calls an external research API and a language model for minutes at a time, so long running work is central, not an afterthought. Compliance is the revised Swiss FADP with GDPR readiness for EU clients, cookie consent, and WCAG 2.2 AA on every page; the product handles company data, contact data and, later, assessment findings, so where data rests and who can read which row are load bearing. The team is tiny and must ship weekly, so anything that needs operating (a server, a queue, a database) costs product time. There is no code yet, so the cost of a wrong foundational call is low today and very high after Slice 1.

Not deciding means the scaffold guesses, the first migration has no access model, and each of the next 23 features re asks the same questions.

## Options considered

Full stacks are compared, not single tools. The stack you named is Option 1.

### Option 1: Next.js on Vercel, Supabase, Trigger.dev cloud, AI SDK with AI Gateway

One Next.js app on Vercel; Supabase in Zurich for Postgres, auth, storage and realtime with RLS as the access model; Trigger.dev cloud (EU) for jobs; AI calls through the Vercel AI Gateway; Resend, Sentry EU and PostHog EU around it.

**Pros**:
- Fully managed; nothing to operate for a team of one or two. (basis: managed platform over self operated infrastructure for small teams)
- Auth, database, storage and realtime share one access model (`auth.uid()` in RLS), so authorization is written once. (basis: org isolation designed on day one)
- Long running work has retries, logs and run ids from day one, outside function timeouts. (basis: serverless is not for long running work)
- Data at rest in Switzerland; jobs, errors and analytics in the EU. (basis: Supabase and Trigger.dev region pages, verified)

**Cons**:
- Vendor spread: seven hosted services see some data, each needing a data processing agreement, and email content plus AI prompts cross to the US.
- The Supabase query builder is weaker than SQL for reporting; complex reads need SQL functions or views.
- Trigger.dev cloud is a second deploy target and a second set of environment variables to keep aligned.

### Option 2: Composable pieces on Vercel: Neon Postgres, Drizzle ORM, Better Auth, Inngest

Same Next.js app, but a plain Postgres (Neon, Frankfurt), Drizzle as the typed data layer, Better Auth as a self hosted auth library on that database, Inngest for durable functions, S3 compatible storage for files.

**Pros**:
- Full SQL power and schema in TypeScript; reporting queries are natural.
- No single BaaS dependency; each piece is replaceable.
- Better Auth gives organizations and invitations as plugins.

**Cons**:
- Authorization moves into application code (a filter on every query), the exact pattern that leaks a row when one query forgets it. (basis: org isolation as an afterthought failure pattern)
- Four vendors to set up and wire together before the first feature, against a three month target.
- No Zurich region for the database; Frankfurt only.
- Realtime, storage policies and auth session handling are three separate integrations instead of one.

### Option 3: Self managed in Switzerland: Next.js plus Postgres plus self hosted Trigger.dev on Exoscale or Hetzner

Docker containers on Swiss or German virtual machines: Postgres, the Next.js app, a self hosted Trigger.dev, MinIO for files, everything inside Switzerland or Germany, model calls through an EU endpoint.

**Pros**:
- Strictest residency story: nothing leaves Switzerland or the EU, including model calls.
- Lowest monthly bill at pilot scale.
- No vendor lock in.

**Cons**:
- Someone must operate Postgres backups, upgrades, TLS, the job runner and its worker fleet; for one or two people that is a large share of the week. (basis: operational reality; never recommend what you would not operate at 2am)
- No preview environments, no automatic scaling, no managed auth; each is rebuilt by hand.
- Slower to a first deployable slice by weeks, against a three month target.

### Option 4: A batteries included monolith framework on a Swiss PaaS (Ruby on Rails or Django)

Rails with Hotwire or Django with HTMX, Postgres, Sidekiq or Celery for jobs, deployed on a managed platform.

**Pros**:
- Decades of conventions for auth, admin screens, jobs and localization in one framework.
- A generated admin makes the ops area nearly free.

**Cons**:
- Two languages once the UI needs React quality interactivity (dashboards, charts, embedded BI), and the AI SDK and Trigger.dev ecosystems are TypeScript first.
- The named stack and the team's expertise are TypeScript; switching costs more than it saves.
- A managed Swiss PaaS for Ruby or Python is thinner than Vercel plus Supabase for Node.

## Rationale

Option 1 wins on the forces that matter most here: a tiny team with a three month target, a product whose core thread is long running background work, and a compliance scope where the row level access model must be right from the first migration. RLS in the database is the one design that makes a leaked organization row a policy bug rather than a bug in any of hundreds of queries; that single property outweighs the reporting convenience of an ORM (basis: org isolation designed on day one). Trigger.dev keeps the research pipeline and every AI generation outside function limits, which the serverless part of the stack cannot do on its own (basis: serverless for stateful or long running workloads is a known failure pattern). Everything is managed, so the team's week goes to product.

The residency stance (data at rest in Switzerland or the EU, processing may cross to the US under data processing agreements) is what most Swiss B2B SaaS do under the revised FADP, and Option 1 meets it with Zurich for Supabase, Frankfurt for Vercel functions and Trigger.dev, and EU regions for Sentry and PostHog (basis: the Supabase, Trigger.dev and Resend region pages verified on 2026-09-02). The remaining crossings (email content at Resend, prompts at Anthropic through the gateway) are disclosed in the privacy policy, and because every model call goes through one module, an EU model endpoint (through the gateway if it can pin a region, else a direct Bedrock or Vertex provider) is a change inside that module if a contract ever demands it.

Option 3 was the honest alternative if residency were absolute, and it is the right answer for a bigger team with an operations person; it is the wrong answer for two people shipping weekly. Option 2 is a fine stack in general but trades the one thing this product needs most (authorization enforced by the database) for query ergonomics. Option 4 fights the named stack and the team's language.

The finer picks follow the same rules: reuse what the stack already runs (Supabase Auth, Supabase Storage, Supabase Realtime, Vercel Firewall for rate limits) over a new vendor; boring and current over new (pnpm, Node 22, Vitest, Playwright); and one tool per job (Biome for lint and format, its accessibility rule group on, with axe in Playwright as the second net for what that group does not cover). Server Components plus Server Actions were chosen over tRPC or REST because the product is mostly server rendered and no public API is in scope (basis: the scope's Deferred list). Realtime through Postgres changes rather than Trigger.dev's browser hooks keeps RLS as the only access model, at the cost of one channel per open dashboard.

**Engineer's stated preferences and where I would have differed:** none. Every recommended pick was taken. The one place a reviewer might push back is Biome over ESLint given the WCAG requirement; the compensating control (axe assertions on every Playwright page test) is recorded in Consequences, with the fallback of adding the ESLint accessibility plugin beside Biome if it proves too late in the loop.

## Landscape check evidence (2026-09-02)

Run once in a read only subagent before the finer picks. Full notes with overflow: `docs/.agent-cache/research/stack-architecture.md`.

| Item | Finding | Status |
|---|---|---|
| Supabase regions | Zurich (`eu-central-2`) and Frankfurt (`eu-central-1`) both offered | Verified on page |
| Trigger.dev v4 cloud | EU region in Frankfurt; self hosting via Docker or Kubernetes supported | Verified on page |
| Vercel AI Gateway | Claude Sonnet 5 listed, providers Anthropic, AWS Bedrock, Google Vertex; no explicit EU routing documented | Verified on page |
| Resend | EU sending region (Ireland) exists; message data stored in the US; DPA and Data Privacy Framework | Verified on page |
| next-intl | v4.4, full Next.js 16 App Router support | Verified on page |
| PostHog EU Cloud, Sentry EU region | Believed offered | From knowledge, not verified (Follow-up) |
| Biome | Believed current and suitable for React and Next.js | From knowledge, not verified (Follow-up) |
| Supabase branching and declarative schema | Branching billed per branch hour; declarative schema in the CLI | From knowledge, not verified |
| Vercel regions | Frankfurt `fra1`, no Zurich | From knowledge, not verified (Follow-up) |
| Parallel Task API docs | Not verified; cite by name only | Not verified |

## Cross check record (2026-09-02)

An independent read only critique on a different model (Opus) found the design sound and listed 24 decisions a scaffold builder would otherwise invent plus 13 soundness notes. All were applied to `index.md` except two, kept on the engineer's original choice: Realtime stays the default for job progress with polling as fallback (the reviewer suggested polling first), and the Stripe webhook handler with its events table stays in feature 11 (the reviewer wanted it in the scaffold). The notable corrections: the role claim comes from a custom access token hook read in the proxy; tasks get their own service client; the Trigger.dev staging key sits in Vercel's Preview scope; migrations, type drift, task deploys and Playwright each got a named CI job and credential; the Vercel production branch must be changed to `production`; `api` stays outside the locale segment with the proxy matcher skipping it; locale detection is off with `/` redirecting to `/de`; Realtime authorization rules are stated; env validation is split per context; the AI Gateway uses an explicit key everywhere; PostHog uses one project key; Supabase's publishable and secret key names are used; authenticated areas are fully dynamic; AC-3 was softened because staging tasks only exist after the first merge; and the Consequences now say that Biome does ship accessibility rules, that previews need a wildcard redirect URL, that the Vercel Firewall cannot limit Supabase Auth calls, and that tasks bypass RLS.

## References

**Project sources** (verifiable, in this repo):
- The installed `supabase` skill (`supabase/agent-skills`, `.claude/skills/supabase/`): publishable over legacy keys, authorization claims in `app_metadata`, RLS on every exposed table, the policy patterns named in the security model.
- `docs/scope/index.md` and `docs/scope/foundations.md`: the named stack, the three user types, the Tracer Bullet approach, the GA tier, the Release 1 target, and the Deferred list (no public API, no EU VAT).
- The product decisions recorded during `/scope` on 2026-09-02 (invited experts, human confirmed matching, pay first booking, embedded BI, two languages).

**Practices & standards**:
- Org isolation designed on day one, enforced by row level security rather than per query filters.
- Serverless functions are not for long running or stateful work; durable job runners are.
- Managed platforms over self operated infrastructure for teams without an operations function.
- Monolith first; extract services only at a measured bottleneck or a team boundary.
- Backward compatible migrations (expand, then switch, then contract) when previews share a database.
- Revised Swiss Federal Act on Data Protection (FADP) with GDPR readiness; WCAG 2.2 AA.

**Links** (web verified on 2026-09-02 during the landscape check):
- Supabase regions: https://supabase.com/docs/guides/platform/regions
- Trigger.dev self hosting overview (cloud regions noted there): https://trigger.dev/docs/self-hosting/overview
- Claude Sonnet 5 on the Vercel AI Gateway: https://vercel.com/ai-gateway/models/claude-sonnet-5
- Resend sending regions: https://resend.com/docs/dashboard/domains/regions
- next-intl routing setup: https://next-intl.dev/docs/routing/setup

## Amendment 2026-09-06: Trigger.dev environments on the free plan

**Context.** The Trigger.dev project `proj_fqmmullopmjdfqkqdrca` runs on the free plan, which ships only the Development and Production environments; Staging and Preview are behind an upgrade. The 2026-09-02 design assumed a Staging environment for `main` and pull request previews, so `deploy.yml` targeted `--env staging` and every run on `main` from 2026-09-05 failed with "staging environment not found". The Production environment already carried the task variables, set by hand as if it were staging.

**Options considered.**

1. *Upgrade the plan now.* Restores the design immediately. Con: a monthly cost for an environment nothing production shaped needs yet.
2. *Deploy `main` into the Production environment now, upgrade before the `production` branch exists (chosen).* Zero cost today, one line in `deploy.yml`, the variables are already there. Con: the environment's name lies for a while, and the switch back is a manual checklist that must happen before the first production merge.
3. *A second free Trigger.dev project for production.* Stays free forever. Con: two dashboards, two access tokens, `TRIGGER_PROJECT_REF` varying per branch in CI, and a project whose "Production" is staging; standing confusion for a team of one or two.

**Rationale.** Option 2 costs nothing until production is real and keeps the original three environment design as the end state; the upgrade is a small fixed cost against the operational clarity of one project (basis: boring and predictable operations for a tiny team, the same force that chose Option 1 in 2026-09-02). Option 3 would bake a naming lie into the CI and the runbooks permanently.

**Also folded in.** The AI row now says AI SDK v7 (spec 0007 shipped it), the `tasks` CI line names the pinned CLI scripts (the `pnpm dlx trigger.dev@latest` form pulled a newer CLI than the pinned SDK and aborted in CI, fixed in PR #13), and the status closed to Accepted because scope feature 1 was marked done on 2026-09-05.
