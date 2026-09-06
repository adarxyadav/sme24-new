# Company research pipeline

_How a company name becomes cited safety KPIs (spec [0007](specs/0007-company-research-pipeline/index.md)). The code lives in `src/features/research/` (form, actions, query, dashboard), `src/lib/research/` (providers, extraction, resolve rules), `src/lib/ai/` (the Claude validation call) and `src/trigger/research-company.ts` plus `src/trigger/sweep-research-runs.ts`. This file is the runbook: the shape of the pipeline, the fixture mode, the error codes and the per environment checklist._

## How a run travels

1. **The client submits the form on `/app`.** `requestResearch` inserts the company (`name`, normalised `website`, country `CH`) and a `queued` run under the members insert policy. The database holds the two guards: one open run per company (`research_runs_one_open_per_company_idx`) and five runs per organization per rolling 24 hours (`private.research_run_allowed`). The action maps the two errors to `run_in_progress` and `quota_exceeded`. Only the earliest non archived company of an organization is ever shown, so two submits that race the "does a company exist" check are reconciled after the insert: the losing row is archived and the caller gets `company_exists` for the winner, never a second run.
   The dashboard shows the same count (`loadQuota` in `src/features/research/queries.ts`), spelled as a PostgREST filter rather than SQL; `supabase/tests/research_runs.test.sql` asserts the two expressions count the same rows, so the displayed "n of 5 runs left" cannot drift from what the policy enforces.
2. **The action triggers `research-company`** with `{ runId }` under the global idempotency key `research/<runId>` and stores the Trigger.dev run id. A failed trigger closes the run as `trigger_failed` (that row does not count against the quota).
3. **The task searches.** It loads the run with the service client and keys every later read and write by that row's ids. `queued` becomes `running`, the provider run is created from the company name, legal name, website and country plus the output schema built from the catalogue, and `provider_run_id` is stored before the first poll. Polls every 15 seconds inside a 20 minute wall clock budget; a retry resumes the stored provider run.
4. **Claude checks every value.** One structured call through the AI Gateway receives the catalogue and the candidates with their citations and answers per value: supported or not, the value in the catalogue unit, the year and a confidence. Claude also names which of the field's citations support each value (`sourceIndexes`), and only those are stored on the row, so a source shown under a value is one the validator judged to support it; when it names none, all of the field's citations are kept. Values are dropped as `unsupported`, `unparseable`, `out_of_range`, `bad_year` or `conflict` and every drop is recorded in `summary.dropped`. When the call fails after the SDK's retries the run continues with the provider's values, confidence capped at 0.5 and `summary.validation` `skipped`; the dashboard shows "not verified".
5. **The task saves.** One `company_kpis` row per kept value with its sources, company facts filled only where the column is still null, then the terminal write (`succeeded` when at least one row exists, else `empty`) guarded by `status = 'running'`.
6. **The dashboard follows the row** over Supabase Realtime with a five second refresh as the fallback, and renders the table, the confidence badges, the source popovers and the run's source list once the run is terminal.

## Fixture mode (local, Playwright, previews)

`RESEARCH_PROVIDER=fixture` (the default whenever `PARALLEL_API_KEY` is empty) answers from `src/lib/research/fixture.ts`: any name gives eight KPIs for the years current minus 1 to current minus 3 with five sources, a name containing `empty` gives an empty result, a name containing `fail` throws a provider failure (case insensitive). The fixture pauses about two seconds per step so the progress list is visible. The validation call still runs when `AI_GATEWAY_API_KEY` is set, so a local run with the key takes the fixture time plus one Claude call.

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
- [ ] **Schedule**: deploy once after merge so the `sweep-research-runs` schedule (`*/15 * * * *`) and the `research` queue (concurrency 5) register; check them in the Trigger.dev dashboard.
- [ ] **Slack**: the environment's `OPS_ALERT_WEBHOOK_URL` (feature 7) receives the failure alerts.
- [ ] **Spike**: run one real research on a known Swiss company and compare the stored values, confidences and drops with the source reports; adjust the catalogue ranges or the prompt (bump `PROMPT_VERSION`) if needed.
- [ ] **Vercel Firewall**: a rate limit rule on the lookup action (spec 0001 hosted checklist).

## Cost review

`summary.durations` (`searchMs`, `validationMs`, `totalMs`), `summary.processor` and `summary.sourcesFound` on every finished run, plus the structured log lines (`runId`, `organizationId`, `companyId`, `providerRunId`, `elapsedMs`), let ops read the cost of a run without opening the provider console.
