# feat/marketing-ux — branch scope

Polish on shipped work (feature 13, marketing site, already `done`). Not a new
feature: no spec, no `/architect`. `/develop` plus your own eyes plus
`pnpm budget` is the whole process.

## In scope

- The seven public pages under `src/app/[locale]/(marketing)/` — UI, UX, layout,
  motion, art direction, to the standard of a 2026 product company.
- `src/features/marketing/**` — the page sections, packages, site facts, register.
- Marketing copy in `messages/de-CH.json` and `messages/en-CH.json`, **the
  `marketing` namespace only**.
- What we call the benchmark, **on the marketing pages only** (see Naming).
- Design system growth, **additive only** (see below).

## Out of scope

Anything here means stop and open a separate branch:

- Schema, migrations, RLS, `supabase/**`.
- The benchmark model: `src/features/benchmark/model.ts`, `MODEL_VERSION`,
  `SNAPSHOT_SCHEMAS`, `benchmarks:recompute`.
- The research pipeline and any model call.
- Signed in areas: `/app`, `/expert`, `/admin`.
- Email templates and subjects.
- Message catalog namespaces other than `marketing`.

## Design system: additive only

Allowed: a **new** token in `src/app/globals.css`, a **new** primitive, a **new**
section on the ops only `/admin/design` gallery, a **new** section in
`docs/design.md`.

Not allowed: changing the **value** of an existing token, or an existing
component's default styling. Those restyle `/app`, `/expert` and `/admin` — areas
nobody is looking at while working on a marketing page. If a value genuinely must
change, that is its own change on its own branch, reviewed across all four areas.

Check before every PR — additive shows as pure `+` lines:

```
git diff main -- src/app/globals.css docs/design.md src/components/
```

`src/components/` is in the command because the token files alone do not catch
the second half of the rule: a shared primitive restyled in place changes
`/app`, `/expert` and `/admin` without touching a token. The weight cap of
2026-09-10 is the worked example — it landed as four `-` lines under
`src/components/` (`app-sidebar`, `page-header`, `signature`, `logo`) and none
in `globals.css`.

Any `-` line touching an existing token or a primitive's default styling is the
thing to challenge. A deliberate exception answers with the decision behind it
and the gate that holds it — the weight cap answers with the owner decision and
`tests/font-weight.test.ts`.

## Naming

Both buyers are in play (safety manager and CFO/MD), so the CHF figure leads and
the peer comparison is the proof: the safety manager can carry a franc number to
their boss, and the CFO reads it directly. "Benchmark" stays as the honest
descriptive word, but stops being the headline.

Marketing pages first. The dashboard heading ("Benchmark and opportunity", which
is currently backwards) and the email subject are a deliberate second pass, once
the name has proven itself where it is fastest to see.

## Gates

- `pnpm budget` — first load JavaScript per page; a hard gate on these pages.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`.
- A grouped four digit number in a client component must be deferred until mount:
  ICU groups it differently on Node and in the browser, and the hydration
  mismatch leaves every control in that component inert.

## Local notes

- Own `node_modules`, own `.env.local` (both copied at creation).
- Run dev on its own port: `pnpm dev --port 3002`. The main checkout holds the
  Next 16 dev lock on 3000.
- **Never run `pnpm db:reset` here.** Worktrees share one local Supabase stack and
  a reset silently skips another worktree's migrations. Marketing pages are static
  and need no database, which is why this branch is the safe parallel one.
