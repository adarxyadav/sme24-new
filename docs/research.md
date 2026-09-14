# Company research pipeline

_How a company name becomes cited safety KPIs (spec [0007](specs/0007-company-research-pipeline/index.md)). The code lives in `src/features/research/` (form, actions, query, dashboard), `src/lib/research/` (providers, extraction, resolve rules), `src/lib/ai/` (the Claude validation call) and `src/trigger/research-company.ts` plus `src/trigger/sweep-research-runs.ts`. This file is the runbook: the shape of the pipeline, the fixture mode, the error codes and the per environment checklist._

## How a run travels

1. **The client submits the form on `/app`.** `requestResearch` inserts the company (`name`, normalised `website`, the country the client picked) and a `queued` run under the members insert policy. The country is required and has no default since spec 0022 (AC-1), so a company is never created as Swiss by omission; it sets `companies.currency`, the peers the run looks for and the experts the page suggests. The database holds the two guards: one open run per company (`research_runs_one_open_per_company_idx`) and five runs per organization per rolling 24 hours (`private.research_run_allowed`). The action maps the two errors to `run_in_progress` and `quota_exceeded`. Only the earliest non archived company of an organization is ever shown, so two submits that race the "does a company exist" check are reconciled after the insert: the losing row is archived and the caller gets `company_exists` for the winner, never a second run.
   The dashboard shows the same count (`loadQuota` in `src/features/research/queries.ts`), spelled as a PostgREST filter rather than SQL; `supabase/tests/research_runs.test.sql` asserts the two expressions count the same rows, so the displayed "n of 5 runs left" cannot drift from what the policy enforces.
2. **The action triggers `research-company`** with `{ runId }` under the global idempotency key `research/<runId>` and stores the Trigger.dev run id. A failed trigger closes the run as `trigger_failed` (that row does not count against the quota).
3. **The task searches.** It loads the run with the service client and keys every later read and write by that row's ids. `queued` becomes `running`, the provider run is created from the company name, legal name, website and country plus the output schema built from the catalogue, and `provider_run_id` is stored before the first poll. Polls every 15 seconds inside a 20 minute wall clock budget; a retry resumes the stored provider run.
4. **Claude checks every value.** One structured call through the AI Gateway receives the catalogue and the candidates with their citations and answers per value: supported or not, the value in the catalogue unit, the year and a confidence. Claude also names which of the field's citations support each value (`sourceIndexes`), and only those are stored on the row, so a source shown under a value is one the validator judged to support it; when it names none, all of the field's citations are kept. Values are dropped as `unsupported`, `unparseable`, `out_of_range`, `bad_year` or `conflict` and every drop is recorded in `summary.dropped`. When the call fails after the SDK's retries the run continues with the provider's values, confidence capped at 0.5 and `summary.validation` `skipped`; the dashboard shows "not verified".
5. **The task saves.** One `company_kpis` row per kept value with its sources, company facts filled only where the column is still null, then the terminal write (`succeeded` when at least one row exists, else `empty`) guarded by `status = 'running'`.
6. **The peer search runs after the terminal write.** `research-company` triggers `research-peers` (spec 0022) and, when that trigger fails, triggers `benchmark-company` itself, so a benchmark is always queued. The peer task is described in [benchmark.md](benchmark.md) ("Where the peers come from"); what matters here is that it is a second task on the same `research` queue with its own 20 minute budget and three attempts, that it stores `research_runs.peer_provider_run_id` before its first poll so a retry resumes the same provider run, and that it **never writes `research_runs.status` or `error_code`**. A peer failure raises no alert and reports through `summary.peers` alone: peers never decide a run's status, which is still `succeeded` because at least one client KPI row was stored.
7. **The dashboard follows the row** over Supabase Realtime with a five second refresh as the fallback, and renders the table, the confidence badges, the source popovers and the run's source list once the run is terminal. A client can overwrite or add a value by hand in the "Your figures" card under the table; such a cell reads "Your figure" instead of a confidence badge, and the rules live in the "Client figures" section of [benchmark.md](benchmark.md).

## `summary.peers`

The peer task's only channel (`peersSummarySchema` in `src/features/research/summary.ts`). Read it on the run row when a client asks why their table is thin or empty:

| Field | Meaning |
|---|---|
| `status` | `ok`, `skipped` (no section or no country to search on), `failed`, `timeout`. Never `succeeded`/`empty`: those belong to the run. |
| `found` | How many peers were kept after the drops. `0` with `status: ok` is a real outcome, not an error. |
| `rung` | `country`, `region` or `world`, computed in code from where the usable rates actually sit; null when nothing was kept. |
| `thin` | True when the comparison rests on fewer than three peers, so the page shows the count instead of a rank. |
| `dropped` | Up to 50 `{ name, reason }`, the reason `self` (the client under another name) or `unsupported` (no rate the validator supported). |
| `validation` | `passed`, or `skipped` when the Claude call failed after its retries and the code converted values were kept at confidence 0.5. |
| `promptVersion` | `peer-validation@1`. |
| `durationMs` | The peer search's own wall clock, beside the client run's in `summary.durations`, for the cost review below. |
| `reason` | A short safe sentence naming the cause, on `failed` and `timeout` only. |

## Fixture mode (local, Playwright, previews)

`RESEARCH_PROVIDER=fixture` (the default whenever `PARALLEL_API_KEY` is empty) answers from `src/lib/research/fixture.ts`: any name gives eight KPIs for the years current minus 1 to current minus 3 with five sources, a name containing `empty` gives an empty result, a name containing `fail` throws a provider failure (case insensitive). The fixture pauses about two seconds per step so the progress list is visible. The validation call still runs when `AI_GATEWAY_API_KEY` is set, so a local run with the key takes the fixture time plus one Claude call.

The peer search has its own fixture behaviours (spec 0022, AC-11): any name gives eight peers, five in the client's country, two in its region and one outside it, carrying three different printed units so the code conversion is exercised on every run; a name containing `thinpeers` gives two peers on the world rung with `thin` true; `empty` and `fail` behave as they do for the client run and give no peers.

Locally: `supabase start`, `pnpm dev`, `pnpm trigger:dev` (the CLI reads `.env.local`), sign in as a client and enter a company. `TRIGGER_DEV_RUNNING=1 pnpm test:e2e e2e/research.spec.ts` drives the three fixture outcomes end to end with axe on every state; without the worker the spec asserts the queued state only, and it skips on a deployment.

## Error codes

`research_runs.error_code` and the message the client sees (`research.errors.<code>` in both catalogs):

| Code | Set by | Meaning |
|---|---|---|
| `trigger_failed` | the action | Trigger.dev could not be reached; the row does not count against the quota. |
| `provider_rejected` | the task | The provider answered a 4xx other than 429, or reported the run as failed; not retried. |
| `provider_unavailable` | the task | Network errors, 429 and 5xx exhausted the three attempts. |
| `provider_timeout` | the task | No result within 20 minutes of `started_at`, across attempts. |
| `internal` | the failure hook | Anything else, including a `maxDuration` kill. |
| `stale` | the sweep | `queued` for more than 30 minutes or `running` for more than 60. |

Every failure raises the `research.run_failed` Slack alert once (`research-failed/<runId>` or `research-stale/<runId>`) with a button to the Trigger.dev run page; details reach Sentry with the `research_run_id` tag.

## Per environment checklist (staging, then production)

- [ ] **Parallel**: an account with billing enabled; a key per environment in Trigger.dev as `PARALLEL_API_KEY`. Leave it empty (or set `RESEARCH_PROVIDER=fixture`) on an environment that must not spend credits; a deployed task without the key and without the explicit fixture setting refuses to start.
- [ ] **AI Gateway**: `AI_GATEWAY_API_KEY` in Trigger.dev (already required when deployed); the model is `anthropic/claude-sonnet-5` in `src/lib/ai/gateway.ts`.
- [ ] **Schedule**: deploy once after merge so the `sweep-research-runs` schedule (`*/15 * * * *`) and the `research` queue (concurrency 5) register; check them in the Trigger.dev dashboard. `research-peers` shares that queue.
- [ ] **Slack**: the environment's `OPS_ALERT_WEBHOOK_URL` (feature 7) receives the failure alerts. Nothing alerts on a peer failure by design.
- [ ] **Spike**: run one real research on a known company in the owner's sector and compare the stored values, confidences and drops with the source reports; adjust the catalogue ranges or the prompt (bump `PROMPT_VERSION`) if needed. **The same run is the peer search spike** (spec 0022): read how many peers came back, how many the validator supported, which rung the run landed on, and whether the reported units match what the cited pages print. The box and what to read are in [benchmark.md](benchmark.md) under "Hosted spike, owed before the first real client"; tick it there, not here.
- [ ] **Vercel Firewall**: a rate limit rule on the lookup action (spec 0001 hosted checklist).

## Cost review

`summary.durations` (`searchMs`, `validationMs`, `totalMs`), `summary.processor` and `summary.sourcesFound` on every finished run, plus the structured log lines (`runId`, `organizationId`, `companyId`, `providerRunId`, `elapsedMs`), let ops read the cost of a run without opening the provider console. Since spec 0022 a finished run is **two** provider runs and **two** Claude calls, not one of each: `summary.peers.durationMs` carries the peer search's own wall clock, and whether that second search earns its cost is exactly what the hosted spike is for.
