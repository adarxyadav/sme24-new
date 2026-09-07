# 0012. Named peer comparison

**Date**: 2026-09-07
**Status**: In Progress

**Amends spec [0008](../0008-peer-benchmark-chf-opportunity/index.md)**, whose rationale states that nothing in the benchmark calls a model. That rule is narrowed, not dropped: see [The model call line](#the-model-call-line) below, which is the binding part of this amendment.

## Summary

Today the benchmark places a client against published industry statistics, mostly the Suva accident table, using arithmetic only. This feature adds a second layer: a comparison against about ten real Swiss companies in the same industry section and size band, each researched once through the existing research pipeline and shared by every client in that industry. Peers are proposed by a model call, approved by ops before any money is spent, and shown to clients anonymised as Peer A to Peer J with the names and sources listed in the disclosure panel. The industry statistics stay the basis for every ranking, percentile and CHF figure; the peer layer is display and a peer set percentile on top. The arithmetic stays pure and the snapshot stays immutable.

## Requirements

**User stories**:
- As a client, I want to see where I sit among companies like mine, not only inside a statistical band, so that the comparison feels real rather than abstract.
- As a client, I want to know which companies I am being compared against and where their numbers came from, so that I can check the claim before I repeat it to my management.
- As an ops team member, I want to review proposed peers before they are researched, so that no client is compared against a company that does not belong in the set and no research spend happens on a bad candidate.
- As an ops team member, I want to see when each peer was last researched and rerun one on demand, so that the peer set does not silently age.
- As a client in an industry with no peer set yet, I want the dashboard to look exactly as it does today, so that the feature never makes the product worse while it is being filled in.

**Acceptance criteria**:

- **AC-1**: A `peer_companies` row exists for each peer, linked one to one to a `companies` row inside a single ops owned house organization, carrying its NOGA industry section, size band, status, display label, and `researched_at`. Client organizations never own a peer company.
- **AC-2**: Ops can open `/admin/peers`, pick an industry section and size band, and run a proposal; a model call returns candidate Swiss companies with a one line reason each, stored as `status = 'proposed'` with the model, prompt version and reason recorded. No research run is triggered by proposing.
- **AC-3**: Ops approve or reject each proposed candidate individually. Approving goes through `public.approve_peer_company`, a security definer function that in one transaction takes an advisory lock on the section and band, refuses beyond ten approved peers, assigns the next free display label (`Peer A` to `Peer J`), and sets `status = 'approved'`, `approved_by` and `approved_at`. Two ops approving at once cannot produce eleven peers or a duplicate label.
- **AC-4**: Triggering research on approved peers shows ops the peers and the number of runs about to start and requires an explicit confirm; the action then re reads those peers, skips any that are no longer `approved` or that already have an open run, inserts one `research_runs` row per remaining peer through the service client, and triggers the unchanged `research-company` task with that run id. `researched_at` and `last_run_id` are set when each run ends `succeeded` or `empty`.
- **AC-5**: `private.research_run_allowed` gains a branch for the house organization with a higher limit than the five runs per rolling 24 hours that client organizations get, so a ten peer batch never trips the client limit and a runaway loop is still bounded in the database. Because the peer path writes through the service client and so bypasses RLS, the ops confirm in AC-4 is the primary gate and this branch is the backstop.
- **AC-6**: A peer's KPI values are ordinary `company_kpis` rows written by the existing pipeline with `source = 'research'` and their source citations, with no new column and no second write path.
- **AC-7**: Any authenticated user can read an approved peer's `companies` row and its `company_kpis` rows. A proposed, rejected or retired peer is readable by ops only. No client can read another client's company or KPI rows through the widened policies.
- **AC-8**: `computeBenchmark` receives approved peer values as an argument and returns, per KPI, a peer set block holding the peer count, each peer's label and value, the client's percentile within the set, and the set minimum and maximum. The percentile is `100 * (worse + 0.5 * equal) / n`, where `worse` counts peers the client beats in the KPI's `direction` (`lower_is_better` inverts) and `equal` counts exact ties, rounded by the existing percent rule. It performs the whole computation as pure arithmetic with no I/O and no model call.
- **AC-9**: The peer set block is present for a KPI only when at least five approved peers hold a value for it in the same industry section and size band. Below five, that KPI shows the industry band exactly as it does today plus a quiet note that there is not enough peer data yet. `iso_45001_certified` never gets a peer set at any count, because a percentile over a yes or no value is meaningless; it keeps its current display.
- **AC-10**: Ranking, gap order, positions, quartiles, the CHF cost estimate and both saving figures are computed from the `benchmarks` statistics table and the assumptions exactly as spec 0008 defines them. Adding or removing peers changes no CHF figure and no gap rank.
- **AC-11**: `MODEL_VERSION` is `benchmark-model@2` and `SNAPSHOT_SCHEMAS` holds both `benchmark-model@1` (unchanged, for existing rows) and `benchmark-model@2`. The peer block is optional in the v2 schema, so a v2 snapshot in an industry with no peers validates and is field for field identical to a v1 snapshot. No existing snapshot row is rewritten.
- **AC-12**: The dashboard renders a dot strip per KPI where the peer set exists: the `benchmarks` p25 to p75 range shaded behind, one dot per peer, the client's value as a larger filled marker, and the direction of better marked. The axis domain is `[min(peerSet.min, peer.p25, clientValue), max(peerSet.max, peer.p75, clientValue)]` with a small padding, so a peer outside the statistical band stays visible rather than clipped. It passes axe with no violations and carries a screen reader table of the same values.
- **AC-13**: The "How this is calculated" panel lists the peers **the snapshot actually used**, resolved from the `kpiRowId` values stored in its peer block, by legal name with each peer's source links and its `researched_at` date, plus the sentence that peers are labelled anonymously on the chart. The chart and the panel therefore never disagree, including after a peer is retired. Every string is in both catalogs.
- **AC-14**: A daily scheduled task finds approved peers whose `researched_at` is older than twelve months (or null) and triggers a refresh for them through the same path as AC-4, no more than `PEER_REFRESH_BATCH` per run. A peer whose refresh has failed three times in a row is flagged for ops on `/admin/peers` and skipped by the schedule until ops act, so a permanently unresearchable peer cannot retry forever. Ops can rerun a single peer on demand.
- **AC-15**: A peer refresh writes new `company_kpis` rows and leaves every existing `benchmark_snapshots` row untouched. A client picks up refreshed peers at their next snapshot, whether from a research run, a client edit or `pnpm benchmarks:recompute`.
- **AC-16**: A snapshot records the exact peer KPI row ids it compared against, so an old snapshot stays explainable after the peer set changes.
- **AC-17**: A Vitest test fails if anything under `src/features/benchmark/` imports from `src/lib/ai/`, so the pure arithmetic boundary is enforced by the build rather than by convention.
- **AC-18**: A client whose company sits in a section and band with no approved peers sees today's dashboard unchanged, with no empty chart, no error and no extra loading state.

## Decision

**Chosen option**: Option 2: a house organization researching shared peers, with a model proposing candidates and ops approving them.

Peers are ordinary companies inside one ops owned organization, researched by the pipeline that already exists. A model call proposes candidates and a human approves them before any run is spent. Peer values are a display layer over the statistics based benchmark, which keeps every number spec 0008 produces exactly as it is.

**Implementation skills**: `supabase-postgres-best-practices` (`supabase/agent-skills`, `.claude/skills/supabase-postgres-best-practices/`) · `supabase` (`supabase/agent-skills`, `.claude/skills/supabase/`) · `trigger-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-tasks/`) · `recharts` (`andy-spike/skills`, `.claude/skills/recharts/`) · `ai-sdk` (`vercel/ai`, `.claude/skills/ai-sdk/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`) · `playwright-skill` (`testdino-hq/playwright-skill`, `.claude/skills/playwright-skill/`)

## Rationale

The reasoning, the options weighed and the evidence are in [rationale.md](rationale.md).

## The model call line

This is the binding part of the amendment to spec 0008. That spec's rationale says no model call anywhere in the benchmark. This spec narrows the claim rather than dropping it, because the sentence was protecting reproducible arithmetic, and it still does.

**A model call is allowed in exactly two places, both outside the benchmark computation:**

1. **Peer proposal.** `proposePeers` calls `structuredOutput` in `src/lib/ai/gateway.ts` with the industry section and size band and receives candidate company names with a reason each. Its output is a list of names for a human to approve, never a number. A hallucinated candidate costs a rejection click, never a wrong figure.
2. **Peer extraction.** The existing `research-company` task reads the peer's public reports through Parallel and validates the extracted KPIs with the existing prompt, exactly as it does for a client company. This call already existed and is unchanged; it produces sourced KPI values that land in `company_kpis`, and the same validation rules apply.

**A model call is forbidden everywhere else, specifically:**

- `computeBenchmark` and everything else in `src/features/benchmark/model.ts` stay pure functions with no network, no database and no model. Peer values arrive as an argument like every other input.
- Percentiles, ranking, gap order, positions, quartiles, the CHF cost and both saving figures are arithmetic on stored rows. No model touches any of them.
- The snapshot is written from the pure model's return value and stays immutable.
- No model writes prose that appears next to a number on the dashboard.

**Why the line sits there.** The values a client quotes to their board must be reproducible from stored rows: re running `computeBenchmark` on the same inputs must return the same output forever, which is what makes a snapshot auditable and testable. Selecting *which companies to compare against* is a judgement call, not a computation, and it is gated by a human before it has any effect. Extracting a number from a published report is exactly what feature 8 already trusts a model to do, under validation, with sources stored per value.

**How it is enforced.** AC-17: a Vitest test asserts that no file under `src/features/benchmark/` imports from `src/lib/ai/`. The rule is checked by the build, not remembered.

## Feature design

**Data model sketch**:

A seeded house organization, one new table, one new column, and two widened read policies. No new table for peer values: a peer's KPIs are ordinary `company_kpis` rows.

| Entity | Field | Type | Notes |
|---|---|---|---|
| house organization | | | one seeded `organizations` row with a fixed id in the migration, name `SME24 peer research`; no members, ops reach it through their ops role |
| `companies` | `is_peer` | `boolean not null default false` | new column; marks a peer so every existing client query can exclude it |
| `peer_companies` | `id` | `uuid pk` | |
| | `company_id` | `uuid not null` | FK to `companies.id`, `on delete cascade`, **unique** |
| | `industry_section` | `text not null` | one of the 21 NOGA sections `A`..`U` from `catalogue.ts` |
| | `size_band` | `text not null` | `1-49` \| `50-249` \| `250+` \| `all` |
| | `status` | `text not null default 'proposed'` | `proposed` \| `approved` \| `rejected` \| `retired` |
| | `display_label` | `text null` | `Peer A`..`Peer J`, set on approval |
| | `proposed_by` | `text not null` | `ai` \| `ops` |
| | `proposal` | `jsonb null` | `{model, promptVersion, reason, proposedAt}`; null when ops added the peer by hand |
| | `approved_by` | `uuid null` | FK to `profiles.id`, `on delete set null` |
| | `approved_at` | `timestamptz null` | |
| | `researched_at` | `timestamptz null` | last run that ended `succeeded` or `empty`; drives the yearly refresh |
| | `last_run_id` | `uuid null` | FK to `research_runs.id`, `on delete set null` |
| | `failed_refreshes` | `integer not null default 0` | consecutive failed refreshes; reset to 0 on success, at 3 the peer is flagged and the schedule skips it (AC-14) |
| | `created_at` / `updated_at` | `timestamptz not null default now()` | `updated_at` trigger as every other table |

Constraints and indexes:
- `unique (company_id)`
- `unique (industry_section, size_band, display_label) where display_label is not null`
- `index (industry_section, size_band, status)`
- `index (status, researched_at)` for the refresh schedule
- `check (status <> 'approved' or display_label is not null)`
- `check (status <> 'approved' or approved_at is not null)`
- `check (display_label is null or display_label ~ '^Peer [A-J]$')`
- The ten peer cap is not expressible as a table constraint; it lives in `public.approve_peer_company` under an advisory lock (AC-3), with a pgTAP test proving an eleventh approval is refused.

`organization_members` gains a guard: a check or trigger refusing any row whose `organization_id` is the house organization. The house organization has no members by design, and a stray membership row would silently give that user `jwt_org_id() = house org` and a confusing view of peer companies as their own tenant.

`benchmark_snapshots` changes:
- `model_version` values now include `benchmark-model@2`; the column type is unchanged.
- Each entry in the `results` jsonb array gains an optional `peerSet` object (schema below). Nothing is added as a column, so no migration touches the snapshot table beyond a comment.

The `peerSet` block inside a v2 snapshot result entry:

```
peerSet: {
  n: number                 // approved peers holding a value for this KPI, always >= 5
  section: string           // the section the set was drawn from
  sizeBand: string          // the band the set was drawn from
  values: [{ label, value, kpiRowId, periodYear }]   // kpiRowId satisfies AC-16
  percentile: number        // the client's percentile inside the set, 0..100
  min: number
  max: number
}
```

**State transitions** (`peer_companies.status`):

```
proposed --approve--> approved --retire--> retired
   |                     ^                    |
   +---reject---> rejected                    |
                                              +---re-approve---> approved
```

- `proposed` → `approved`: ops action; assigns `display_label`, `approved_by`, `approved_at`.
- `proposed` → `rejected`: ops action; the row stays for history so the same bad candidate is not proposed again.
- `approved` → `retired`: ops action, for a peer that stopped publishing or was wrongly included. Its KPI rows stay but it drops out of every set, and clients in that industry recompute to a smaller set on their next snapshot.
- `retired` → `approved`: ops action; reuses the row rather than creating a duplicate.
- A rejected or retired peer is never researched and never appears in a peer set.

**API surface**:

All ops surfaces are server actions in `src/features/peers/actions.ts` following the project's typed result pattern (`{ ok: true, data }` or `{ ok: false, error }`), reached from `/admin/peers`. There are no new HTTP route handlers.

| Action / task | Kind | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `proposePeers` | server action | `section: string` (req), `sizeBand: string` (req), `count: number` (opt, default 10) | `{ proposed: PeerCandidate[] }` | ops role | `not_authorized`, `ai_unavailable`, `already_full` (ten approved already) |
| `approvePeer` | server action | `peerId: uuid` (req) | `{ id, displayLabel }` | ops role | `not_authorized`, `not_found`, `set_full` (ten already approved), `invalid_status` |
| `rejectPeer` | server action | `peerId: uuid` (req), `reason: string` (opt) | `{ id }` | ops role | `not_authorized`, `not_found`, `invalid_status` |
| `retirePeer` | server action | `peerId: uuid` (req) | `{ id }` | ops role | `not_authorized`, `not_found`, `invalid_status` |
| `researchPeers` | server action | `peerIds: uuid[]` (req) | `{ triggered: number, skipped: PeerSkip[] }` | ops role | `not_authorized`, `set_changed` (a listed peer is no longer approved), `quota_exceeded` |
| `rerunPeer` | server action | `peerId: uuid` (req) | `{ runId }` | ops role | `not_authorized`, `run_in_progress`, `quota_exceeded` |
| `getPeerAdmin` | query | `section` (opt), `sizeBand` (opt), `status` (opt) | peer rows with KPI counts and `researched_at` | ops role | throws on failure, per the project query rule |
| `getPeerSet` | query | `section`, `sizeBand` | approved peers plus their current KPI rows | authenticated | throws on failure |
| `approve_peer_company` | Postgres function (security definer) | `peer_id: uuid` | `display_label` | ops role, execute revoked from `anon` | raises on `set_full` or a wrong status |
| `research-company` | Trigger.dev task | unchanged: `{ runId }` | unchanged | service role | unchanged |
| `refresh-peer-companies` | Trigger.dev schedule | none (daily cron) | `{ triggered: number, flagged: number }` | service role | throws so Trigger.dev retries |
| `benchmark-company` | Trigger.dev task | unchanged payload | snapshot now v2 | service role | unchanged |

**How a peer run is actually started (this is the part most easily got wrong).** `research-company` takes `{ runId }` and does not create its own row, exactly as it works for a client company: the action inserts the `research_runs` row first, then triggers the task with that id. For a peer the action cannot insert under RLS, because the `research_runs` insert policy requires `organization_id = private.jwt_org_id()` and an ops user's JWT never carries the house organization id. So `researchPeers` and `rerunPeer` insert the run row through the **service client**, which is permitted here because these are ops only, server only actions in the pattern `src/trigger/` and server only code already use.

That means the Trigger.dev idempotency key is not what stops a double run. The real guard is the existing `research_runs` unique index of one open run per company: `researchPeers` re reads each peer, skips any that is no longer `approved` or already has an open run (returning it in `skipped` so ops see why), and the index is the backstop if two ops act at the same instant. The task trigger still carries the key `research/peer/<runId>` so a retried trigger of an already created run is a no op, which is what a Trigger.dev key can actually guarantee.

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `proposePeers` | candidate company names | model call via `structuredOutput`, prompt `peer-proposal@1` in `src/lib/ai/prompts/` |
| `proposePeers` | the section and band the prompt describes | `NOGA_SECTIONS` and `SIZE_BANDS` in `src/features/benchmark/catalogue.ts`, passed as prompt input |
| `proposePeers` | the exclusion list (already proposed, approved, rejected) | `peer_companies` rows for that section and band, so the model does not re propose a known name |
| `approvePeer` | `display_label` | the next free label in `Peer A`..`Peer J` for that `(section, size_band)`, computed inside `public.approve_peer_company` under `pg_advisory_xact_lock` on a hash of the section and band, the same pattern `create_organization` already uses |
| `approvePeer` | `approved_by` | the ops user id from `auth.uid()` inside the definer function, never an input parameter |
| `researchPeers` | which peers are actually researched | re read at trigger time: `status = 'approved'` and no open `research_runs` row for that company. The submitted `peerIds` are a request, never the authority, so a stale screen cannot research a peer ops did not mean to |
| `researchPeers` | each new `research_runs` row | inserted by the service client with `organization_id` = the house organization constant, `company_id` = the peer's company, `requested_by` = the ops user id |
| `researchPeers` | the run count shown in the confirm | the length of the re read list, shown before the trigger; `skipped` explains every peer that dropped out |
| `research-company` (peer) | each peer KPI value, its unit, confidence and citations | unchanged from spec 0007: the Parallel result validated by prompt `research-validation@1`, written to `company_kpis` |
| `refresh-peer-companies` | which peers are due | `peer_companies.researched_at` older than twelve months or null, `status = 'approved'`, and `failed_refreshes < 3` |
| `refresh-peer-companies` | the twelve month threshold, the per run cap, the failure limit | constants in `src/features/peers/catalogue.ts` (`PEER_REFRESH_MONTHS`, `PEER_REFRESH_BATCH`, `PEER_REFRESH_MAX_FAILURES`), not env vars, so they are testable and versioned |
| `refresh-peer-companies` | the schedule cadence | a daily cron declared on the Trigger.dev schedule, so a due peer waits at most a day and the batch cap spreads a large industry over several days |
| `research_run_allowed` | the house organization limit | a branch in the existing helper keyed on the house organization constant, returning a higher limit than the client five; the client branch is untouched |
| `benchmark-company` | the peer rows handed to the model | `getPeerSet` for the company's `(section, sizeBand)` resolved by the same `sectionOfDivision` and `sizeBandOf` the benchmark already uses; read with the service client inside the task |
| `computeBenchmark` | `peerSet.n` | count of approved peers with a value for that KPI in the passed rows |
| `computeBenchmark` | `peerSet.percentile` | pure arithmetic: `100 * (worse + 0.5 * equal) / n`, direction aware via `direction` on the KPI catalogue entry (`lower_is_better` inverts which peers count as worse), ties counted as half, rounded per the existing percent rule. The client is not counted in `n` |
| `computeBenchmark` | whether a KPI gets a peer set at all | `n >= 5` **and** the KPI is not `iso_45001_certified`, both checked inside the pure function from the passed rows |
| `computeBenchmark` | `peerSet.values[].label` | `peer_companies.display_label`, carried on the passed row; never the company name |
| `computeBenchmark` | `peerSet.values[].kpiRowId` | `company_kpis.id` of the peer value used, satisfying AC-16 |
| `computeBenchmark` | `peerSet.min` / `.max` | pure arithmetic over the passed peer values |
| dashboard chart | the shaded p25 to p75 range | unchanged: the matched `benchmarks` row already in `results[].peer` |
| dashboard chart | the client's marker position | `results[].peer` scale plus the client value from `inputs.kpis[]`, both already in the snapshot |
| dashboard chart | the axis domain | `[min(peerSet.min, peer.p25, clientValue), max(peerSet.max, peer.p75, clientValue)]` plus a small padding, computed in the component from snapshot values only. Peer values and the statistics band are different distributions on one axis, so the domain must span both or a peer outside the band would be clipped without trace |
| disclosure panel | which peers to list | the `kpiRowId` values in the snapshot's peer block, resolved to their companies. The panel lists what the snapshot actually compared against, so the chart and the panel cannot disagree after a peer is retired or refreshed |
| disclosure panel | peer legal names and source links | `companies.legal_name` (falling back to `name`) and `company_kpis.sources` for those resolved rows |
| disclosure panel | each peer's `researched_at` date | `peer_companies.researched_at` for those rows, formatted in the active locale |
| disclosure panel | the "not enough peer data yet" note | rendered when `peerSet` is absent for a KPI but the industry has some approved peers; strings from `messages/de-CH.json` and `messages/en-CH.json` |

**Key invariants**:

- A `peer_companies` row always points at a `companies` row whose `organization_id` is the house organization and whose `is_peer` is true. Enforced by a check on insert through the action plus a pgTAP assertion.
- `display_label` matches `^Peer [A-J]$`, is unique within a `(industry_section, size_band)`, and is set if and only if the status is `approved`.
- At most ten approved peers exist per `(industry_section, size_band)`, held by the advisory lock inside `public.approve_peer_company` rather than by a table constraint, which cannot express a count.
- A `peerSet` block appears in a snapshot only when `n >= 5` and the KPI is not `iso_45001_certified`.
- No `organization_members` row ever references the house organization.
- A peer research run is inserted only by the service client, only for a company in the house organization, and only when that company has no open run.
- `computeBenchmark` is a pure function: same inputs, same output, no I/O, no model, no clock read beyond values passed in.
- Every CHF figure and every gap rank in a v2 snapshot is computed from the `benchmarks` statistics row and the assumptions, never from peer values.
- No `benchmark_snapshots` row is ever updated or deleted by the application; a change writes a new row.
- No client organization ever holds a peer company, and no peer company ever holds a client's KPI row.

**Security model**:

- **Ops role**: full read and write on `peer_companies`; may propose, approve, reject, retire, research and rerun. The only role that sees `proposed`, `rejected` and `retired` rows.
- **Any authenticated user**: read only on approved peers, through two added `select` policies. RLS combines `select` policies with `or`, so these are purely additive to the four existing ones and take nothing away. The predicates, written out because they are the riskiest lines in this feature:

  ```sql
  -- on public.companies
  using (
    is_peer
    and organization_id = <house org constant>
    and exists (
      select 1 from public.peer_companies pc
      where pc.company_id = companies.id and pc.status = 'approved'
    )
  )

  -- on public.company_kpis
  using (
    exists (
      select 1 from public.peer_companies pc
      where pc.company_id = company_kpis.company_id and pc.status = 'approved'
    )
  )
  ```

  Neither recurses (both read `peer_companies`, never the table they are on), and both hit the `unique (company_id)` index on `peer_companies`, so no extra index is needed. Neither can expose a client row, because a client company is never in `peer_companies`.
- **Client organizations**: unchanged, and deliberately so. Existing client policies already filter on `organization_id = private.jwt_org_id()`, and a client's JWT never carries the house organization id, so peer rows can never appear in a client's own company list no matter what the app does. `is_peer` is therefore a marker for the new cross tenant reads and for ops screens, **not** a filter that has to be retrofitted onto existing client queries. Adding it everywhere would be work that protects nothing and would teach the next reader that the filter is what keeps tenants apart, when RLS is.
- **House organization membership**: forbidden by a guard on `organization_members` (see the data model). Without it, one stray membership row would give that user `jwt_org_id() = house org` and, through the ordinary members policy, a client style view of every peer company.
- **Service role**: writes peer KPI rows through the existing task path and writes snapshots, as today.
- **Compliance**: peer values come from published company reports, so no personal data is involved and the revised FADP scope is unchanged. Naming a third party company alongside a safety judgement is a reputational rather than a data protection question, which is why the client facing chart is anonymised and the names live in the disclosure with their sources.

**Configuration required**:

No new environment variables. The feature reuses `AI_GATEWAY_API_KEY` for the proposal call, `PARALLEL_API_KEY` for peer research, and the existing Trigger.dev and Supabase keys. The house organization id is a constant in a migration, not a secret.

**Critical test scenarios**:

- Happy path: ops propose ten peers for section C and band `50-249`, approve seven, confirm and trigger research, seven runs write KPI rows, a client in that section and band recomputes and their dashboard shows a dot strip with seven peer dots and their own marker, verifies **AC-2**, **AC-3**, **AC-4**, **AC-6**, **AC-8**, **AC-12**.
- Purity: a Vitest table feeds `computeBenchmark` fixed inputs with and without peers and asserts every CHF figure, gap rank and position is byte identical between the two, verifies **AC-10**.
- Boundary: a Vitest test asserts no file under `src/features/benchmark/` imports from `src/lib/ai/`, verifies **AC-17**.
- Threshold: four approved peers hold a value for a KPI; the snapshot has no `peerSet` for it and the dashboard shows the band plus the note, verifies **AC-9**.
- Empty: a client in a section with zero approved peers gets a v2 snapshot with no peer block and a dashboard identical to today's, verifies **AC-18**, **AC-11**.
- Immutability: a peer refresh writes new KPI rows; a pgTAP and a Vitest assertion confirm existing snapshot rows are unchanged and the client's dashboard still shows the old figures until their next recompute, verifies **AC-15**, **AC-16**.
- Failure case: `researchPeers` is called twice with the same peer ids while the first batch is still running; every peer comes back in `skipped` with an open run and no second `research_runs` row is written, and a pgTAP test proves the one open run index refuses the row even if the check is bypassed, verifies **AC-4**.
- Concurrency: two `approvePeer` calls race on the tenth and eleventh peer in the same section and band; one gets a label, the other gets `set_full`, and no duplicate label exists, verifies **AC-3**.
- Quota: a ten peer batch runs to completion in the house organization, a pgTAP test proves `research_run_allowed` returns true for the house organization at six runs and false for a client organization at six, verifies **AC-5**.
- Refresh backstop: a peer whose research fails three times in a row is flagged and skipped by the next scheduled run, verifies **AC-14**.
- Consistency: a peer is retired after a snapshot was written; the chart and the disclosure panel still show the same peers, because both resolve from the snapshot's stored ids, verifies **AC-13**, **AC-16**.
- Auth/permission: a signed in client reads an approved peer's company and KPI rows and gets them; the same client requests a `proposed` peer and gets nothing; a client requests another client's company and gets nothing; an expert and an anonymous visitor hitting `/admin/peers` are redirected, verifies **AC-7**.
- Accessibility: axe over the dashboard with a full peer set and over `/admin/peers` returns no violations, and the dot strip exposes an equivalent table to a screen reader, verifies **AC-12**.

## Build plan

Tracer Bullet, as the project default: milestone 1 runs a thin thread from the migration through a hand approved peer, a real research run, the pure model, and a rendered chart, before anything is thickened.

1. [x] **Migration and the house organization**: `supabase/schemas/27_peer_companies.sql` with the table, constraints, indexes, RLS and the `updated_at` trigger; the `is_peer` column on `companies`; the seeded house organization row and the `organization_members` guard; the two widened read policies; the house branch in `private.research_run_allowed`; the `public.approve_peer_company` definer function with its advisory lock and ten peer cap; `pnpm db:diff`, re add the column grants and the `anon` execute revoke the diff drops (both apply here: a new `public` function and a table level revoke), `db:reset`, a pgTAP file `supabase/tests/peer_companies.test.sql` covering the tenant contract, every policy, the cap and the quota branch, then `db:types`. Satisfies **AC-1**, **AC-3**, **AC-5**, **AC-7**.
2. [ ] **Thin thread, one hand added peer end to end**: `src/features/peers/` with `schema.ts`, `catalogue.ts`, `queries.ts` and the `approvePeer` and `researchPeers` actions; a minimal `/admin/peers` screen that lists peers and triggers research with the confirm; the service client run insert with the open run skip, then trigger the unchanged `research-company` with the run id; set `researched_at`, `last_run_id` and `failed_refreshes` on completion. Prove it on one real peer. Satisfies **AC-3**, **AC-4**, **AC-6**.
3. [ ] **The pure peer layer in the model**: extend `ModelInput` with peer rows, add the peer set computation with the stated percentile formula, the five peer threshold and the `iso_45001_certified` exclusion to `computeBenchmark`, bump `MODEL_VERSION` to `benchmark-model@2`, add the v2 schema to `SNAPSHOT_SCHEMAS` keeping v1 intact, read the peer set in `benchmark-company` and pass it in; the import boundary test. Satisfies **AC-8**, **AC-9**, **AC-10**, **AC-11**, **AC-16**, **AC-17**.
4. [ ] **The chart and the disclosure**: the dot strip component behind the shadcn chart wrapper with the stated axis domain and its screen reader table, wired into the dashboard beside the existing `QuartileBand`; the peer list in the "How this is calculated" panel resolved from the snapshot's stored ids, with names, sources and dates; the not enough peer data note; the untouched dashboard when no peers exist; both message catalogs; a section on `/admin/design`. Satisfies **AC-12**, **AC-13**, **AC-18**.
5. [ ] **Proposal, refresh and hardening**: the `peer-proposal@1` prompt and the `proposePeers` action through `structuredOutput` with the exclusion list; `rejectPeer` and `retirePeer`; the full `/admin/peers` screen with per section and band filters, statuses, KPI counts, the flagged peers and the rerun button; the daily `refresh-peer-companies` schedule with the twelve month rule, the batch cap and the three failure flag; Vitest, pgTAP and a Playwright thread with axe; `docs/benchmark.md` gains a peer set section and the ops runbook for filling an industry. Satisfies **AC-2**, **AC-14**, **AC-15**, and completes **AC-12**.

## Consequences

**Positive**:
- The comparison becomes concrete. "You are the third safest of eight companies your size in your industry" is a far stronger sales moment than a quartile band, and it is the same claim the CHF figure already rests on.
- Peer research is paid for once per industry, not once per client. The tenth client in a section costs nothing extra.
- Nothing spec 0008 computes changes. Every existing snapshot stays valid and readable, every CHF figure is reproducible, and the feature degrades cleanly to today's dashboard.
- The research pipeline is reused whole. No second provider path, no second validation prompt, no duplicated extraction logic to drift.
- Peer values are real, sourced and auditable, which strengthens the launch gate in feature 25 rather than competing with it.

**Negative / tradeoffs**:
- Ops now own a recurring data job. Filling 21 NOGA sections across three size bands is a lot of approving and a real research bill, and the yearly refresh keeps costing. In practice only the sections where clients actually are will be filled, which is the honest way to start but means coverage is patchy for a while.
- A model call now exists in the peer path, which is exactly what spec 0008's rationale ruled out. The narrowing above is defensible, but the sentence in that spec is no longer literally true and the amendment has to be read alongside it.
- Widening the read on `companies` and `company_kpis` touches two tables at the heart of the tenant contract. The policies are written out above, are additive to the existing ones, and pgTAP covers them, but this is still the riskiest part of the change and deserves the closest review.
- Peer research runs are written through the service client, so RLS is not the gate on that path. The ops role check in the action, the open run index and the quota branch are, which is a weaker arrangement than the client path and is the reason the ops confirm exists.
- Anonymised labels weaken the moment. "Peer C" is less compelling than a name, and clients will ask who it is; the disclosure answers that, but a click away.
- A peer set that changes between two snapshots changes the client's percentile without the client doing anything. The snapshot records which rows it used, so it is explainable, but it needs explaining.

**Neutral**:
- One new schema file, one new column, two widened policies, one new feature folder, one new prompt, one new scheduled task and one new chart component.
- `MODEL_VERSION` moves to `benchmark-model@2`; `pnpm benchmarks:recompute` will write v2 rows for every company on its next run, which is the intended way for existing clients to gain the peer layer.
- The house organization is a real organizations row with no members, which is a new pattern in this codebase. It is simpler than an exception in the tenant contract, but it means "an organization" no longer always means "a client".
- Feature 25's launch gate should grow a peer coverage line, since a client in an empty section still sees the old dashboard and that is a coverage question ops should see.

## Follow-up

- [ ] Decide with ops which NOGA sections to fill first, driven by where the pilot clients actually sit rather than alphabetically.
- [ ] Add a peer coverage line to the launch gate in feature 25 (`docs/benchmark.md`): how many sections and bands have five or more approved peers with fresh data.
- [ ] Revisit naming after the first pilot clients see the anonymised version. If the disclosure carries the weight and no one objects, showing names on the chart is a one line change plus a copy pass.
- [ ] Watch what a peer research run actually costs across ten companies before filling a second industry, and record the figure in `docs/benchmark.md`.
- [ ] Consider a retired peer's KPI rows: they stay readable today. Decide whether they should be hidden once a peer is retired, or kept so old snapshots stay fully explainable.
