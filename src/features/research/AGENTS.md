# src/features/research

Moved out of the root `AGENTS.md` so it loads only when this area is touched. The root keeps a one line pointer here.

## Company research

`requestResearch` in `src/features/research/actions.ts` inserts the company and a `queued` run and triggers the `research-company` task under the idempotency key `research/<runId>`; the database holds the guards (one open run per company, five runs per organization per rolling 24 hours), never the app. Providers implement the interface in `src/lib/research/provider.ts` (Parallel and the fixture are interchangeable; a second provider is a file in that folder); `RESEARCH_PROVIDER` is `fixture` whenever `PARALLEL_API_KEY` is empty and a deployed task without the key refuses to start. Every model call goes through `structuredOutput` in `src/lib/ai/gateway.ts` (AI SDK v7 through the AI Gateway, prompts versioned in `src/lib/ai/prompts/`); nothing else imports `ai`. A new KPI is a `kpi_definitions` seed row plus a catalogue entry in `src/features/research/catalogue.ts` (a Vitest test keeps them equal); a new error code is a `research_runs.error_code` value plus `research.errors.<code>` keys in both catalogs. The per environment checklist (Parallel key, gateway key, schedule, Slack, spike, firewall) lives in the runbook.
