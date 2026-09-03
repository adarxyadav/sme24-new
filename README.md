# SME24

AI powered EHS consulting marketplace for regulated companies in Switzerland. This repo holds the
whole product: marketing site, client, expert and ops areas, background tasks and the database
schema. The stack and its reasons are in [spec 0001](docs/specs/0001-stack-architecture/index.md);
the plan is in [docs/scope](docs/scope/index.md).

## Run it locally

You need Node 22 (`.nvmrc`), pnpm, Docker (for the local Supabase stack) and the Supabase CLI.

```sh
pnpm install                      # also installs the git hooks (see below)
cp .env.example .env.local        # then paste the two keys `supabase status -o env` prints
supabase start                    # Postgres, Auth, Storage, Realtime, Studio on 127.0.0.1:5432x
pnpm dev                          # http://localhost:3000 redirects to /de
pnpm dlx trigger.dev@latest dev --env-file .env.local   # optional, needs a Trigger.dev project
```

`supabase start` applies `supabase/migrations/` and `supabase/seed.sql`. The seed creates one user
per role plus a second client, all with the password `sme24-local-password`, and one organization
per client so you can check that organizations never see each other's rows:

| Email | Role | Area | Organization |
|---|---|---|---|
| `client@example.com` | client | `/de/app` | Musterfirma AG (owner) |
| `client2@example.com` | client | `/de/app` | Beispiel GmbH (owner) |
| `expert@example.com` | expert | `/de/expert` | none |
| `ops@example.com` | ops | `/de/admin` | none |

Sign in at `/de/sign-in`. The ops admin page has buttons that trigger the smoke test task and send
a test error to Sentry and a test event to PostHog; locally they report "not configured" until you
add the keys to `.env.local`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` / `pnpm format` | Biome (lint, format, import order, accessibility rules) |
| `pnpm test` | Vitest (unit and component tests in `tests/`) |
| `pnpm test:e2e` | Playwright with axe (`e2e/`), against `PLAYWRIGHT_BASE_URL` or a local dev server |
| `pnpm db:reset` | Recreate the local database from migrations and seed |
| `pnpm test:db` | Run the pgTAP policy tests in `supabase/tests/` against the local database |
| `pnpm db:diff <name>` | Write a migration from the declarative schema in `supabase/schemas/` |
| `pnpm db:types` | Regenerate `src/lib/supabase/database.types.ts` (CI fails when it is stale) |
| `pnpm trigger:dev` | Run Trigger.dev tasks locally |

## Git hooks

`pnpm install` installs two git hooks through [lefthook](https://lefthook.dev) (`lefthook.yml`);
the `prepare` script skips this when `CI` is set. The commit message check runs on Node directly,
so use Node 22.18 or newer (`nvm install 22` gives you that).

- `pre-commit`: Biome fixes lint, format and import order on the staged files and re-stages them,
  then `pnpm typecheck` runs on the whole project.
- `commit-msg`: the subject must start with a type, one of `feat`, `fix`, `chore`, `docs`,
  `test`, `refactor`, `ci`, as in `feat(auth): add magic link sign in`. Messages git writes
  itself (merge, revert, fixup, squash) pass. CI runs the same check on every pull request commit.

Skip both once with `LEFTHOOK=0 git commit ...`. Hooks missing after a clone? Run
`pnpm exec lefthook install`.

## Change the database

Edit the SQL in `supabase/schemas/` (tables, policies, functions, triggers live together), then:

```sh
pnpm db:diff add_thing      # generates supabase/migrations/<timestamp>_add_thing.sql
pnpm db:reset               # applies everything locally and reseeds
pnpm test:db                # pgTAP policy tests: every table, every role, the cross tenant deny cases
pnpm db:types               # refresh the generated types
```

Every table enables RLS in the same file that creates it, together with its indexes, policies
and triggers. A client owned table copies the tenant table contract from
[spec 0002](docs/specs/0002-data-model/index.md) and gets a pgTAP file in `supabase/tests/`.
Migrations must stay backward compatible (add, then switch, then remove in a later change)
because previews share the staging database. Check the grants in the generated migration by
hand: the diff engine misses what Supabase's default privileges add at creation (for example
execute for `anon` on a new `public` function) and a table level revoke also drops column grants.

## Where things live

```
src/app/[locale]/(marketing)   public pages, static
src/app/[locale]/app|expert|admin   signed in areas, force-dynamic, gated by role
src/app/api                    machine endpoints (health; webhooks later), unlocalized
src/proxy.ts                   locale routing, session refresh, role gate
src/features/<domain>          ui, actions, queries, schemas per domain
src/components/ui              shadcn/ui primitives
src/lib/supabase               one client factory per execution context, generated types
src/lib/env.ts                 clientEnv(), serverEnv(), taskEnv(): Zod, lazy, per context
src/trigger                    Trigger.dev tasks (+ Sentry instrumentation)
src/i18n + messages/           next-intl routing and strings (de, en)
supabase/schemas               declarative schema (source of truth) -> supabase/migrations
tests/ e2e/                    Vitest, Playwright
```

## Environments and deployment

Three fixed environments, no per branch databases:

| Branch | Vercel | Supabase | Trigger.dev |
|---|---|---|---|
| pull request | preview | staging project | staging (runs `main`'s tasks) |
| `main` | preview + `staging.<domain>` | staging, migrated by CI | staging, deployed by CI |
| `production` | production | prod, migrated by CI | prod, deployed by CI |

GitHub Actions: `ci.yml` (typecheck, Biome, Vitest, generated types check, commit messages on pull
requests) on pull requests and pushes; `deploy.yml` (Supabase migrations, then Trigger.dev tasks)
on pushes to `main` and `production`; `e2e.yml` (Playwright + axe) on every successful Vercel
deployment.

One time setup, outside the repo:

1. **Vercel**: import the repo; Functions region `fra1` (Frankfurt); set the production branch to
   `production`; assign `staging.<domain>` to `main`; add the variables from `.env.example` per
   scope (Preview gets the staging keys, Production the prod keys); Node 22 comes from `engines`.
2. **Supabase**: create a staging and a prod project in Zurich (`eu-central-2`). In each: enable the
   custom access token hook (`public.custom_access_token_hook`) under Auth > Hooks, add the
   Vercel preview wildcard and the staging or production URL to redirect URLs. Store the
   database connection strings as the repo secrets `STAGING_SUPABASE_DB_URL` and
   `PROD_SUPABASE_DB_URL`. Apply `supabase/seed.sql` to staging by hand if you want the seeded
   users there (never to prod).
3. **Trigger.dev**: create the project in the EU region; put its ref in `TRIGGER_PROJECT_REF`, the
   staging and prod secret keys in the matching Vercel scopes, a personal access token in the repo
   secret `TRIGGER_ACCESS_TOKEN`; add the task variables (Supabase URL and secret key, app URL,
   Sentry DSN, PostHog key) to each Trigger.dev environment. Run one manual
   `pnpm dlx trigger.dev@latest deploy --env staging` before the first pull request.
4. **Sentry (EU) and PostHog (EU)**: create the projects in the EU regions; DSN and key go to
   Vercel and Trigger.dev; `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` go to the repo
   secrets and the Vercel build for source maps.
5. **GitHub**: create the repository and push, then protect `main` and `production` so every change
   arrives through a pull request that passed the `check` job. Its status context is the job's
   display name, `Typecheck, lint, unit tests`, not the key `check`. Run once from the repo root
   with the GitHub CLI signed in:

   ```sh
   for branch in main production; do
     gh api --method PUT "repos/{owner}/{repo}/branches/$branch/protection" \
       -F 'required_status_checks[strict]=false' \
       -F 'required_status_checks[contexts][]=Typecheck, lint, unit tests' \
       -F 'required_pull_request_reviews[required_approving_review_count]=0' \
       -F 'enforce_admins=true' \
       -F 'restrictions=null' \
       -F 'allow_force_pushes=false' \
       -F 'allow_deletions=false'
   done
   ```

   `enforce_admins=true` makes the rules apply to you too; switch it to `false` while you are the
   only committer if you want to push straight to `main` now and then. Zero required approvals
   still requires a pull request, which is what a solo maintainer needs. Promotion to production is
   a pull request from `main` into `production`.
