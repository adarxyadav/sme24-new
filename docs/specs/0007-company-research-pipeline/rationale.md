# 0007. Company lookup and research pipeline: rationale

The decision record for [index.md](index.md). `/develop` skips this file.

## Context

The product's promise starts here: a company benchmarks its EHS risk for free, and the free part is only free for the client if a machine does the research. Public disclosures (sustainability reports, annual reports, certification registers, press) hold the safety figures, scattered across PDFs and pages in two or three languages, with different units and reporting years. A run must find them, read them, turn them into the eight numbers the benchmark needs, and say where each number came from, because a client who cannot see the source will not show the figure to their management.

Forces. The work takes minutes and calls two paid vendors, so it cannot run in a request and must survive retries without paying twice. The database contract already exists: spec 0002 shipped `companies`, `research_runs` with its state machine and Realtime, `company_kpis` with per value sources and the `company_kpi_current` view, and spec 0006 reserved the `research.run_failed` alert. Spec 0001 fixed Parallel for research and the AI SDK through the AI Gateway on Claude Sonnet 5 for every model call; what was open was the pipeline shape, how the two share the work, the quota, the failure handling, the lookup and dashboard surfaces, and how the thread runs without spend locally. The team is tiny and ships weekly, so every extra moving part (a webhook route, a second table, a separate ops page) costs a day now and a failure mode later. Compliance is the revised Swiss FADP with GDPR readiness; the data here is public company data, but the vendors are in the US and the DPAs are owed by feature 14.

Not deciding leaves `/develop` to invent the output schema, the confidence rule, the quota and the fixture, the four places a research pipeline goes quietly wrong: values without support, duplicate paid runs, silent drift between what the dashboard shows and what was found, and a flow nobody can test.

## Options considered

### Option 1: Parallel structured research, Claude validation pass (chosen)

One Parallel task run with a JSON output schema derived from the KPI catalogue; Parallel returns a value per field with its basis (citations, confidence, reasoning). One Claude call then checks every value against its cited excerpt, parses the number and the year, normalises units, resolves conflicts and drops what is unsupported or implausible. Both run inside one Trigger.dev task that polls the provider with `wait.for`.

**Pros**:
- Each vendor does what it is built for: Parallel finds and cites, Claude judges and normalises; the validator is a pure function over the provider result, so it runs in fixture mode and in unit tests.
- Per field basis gives per value citations for free; the dashboard's sources popover needs no extra plumbing.
- A validation outage degrades to unvalidated values with capped confidence instead of failing the funnel.

**Cons**:
- Two paid calls per run, two prompts to maintain, and a flat schema of about 31 fields that grows by three per KPI.
- Confidence is a model's judgment on another model's citations; it must be shown honestly as support, not certainty.

### Option 2: Parallel text research, Claude extracts

Parallel returns a research report with citations; Claude extracts the eight KPIs for three years from the report into the catalogue schema.

**Pros**:
- Full control of the extraction schema and the prompt; adding a KPI is a schema line, not a provider field.
- The report reads well for a later "what we found" page.

**Cons**:
- Citations attach to passages of a report, not to values; mapping a number back to its excerpt is Claude's guess, and the sources popover gets weaker.
- Two model passes over long text cost more tokens per run than one structured call.

### Option 3: Parallel structured research only

Trust Parallel's output and basis directly and store them; no Claude call.

**Pros**:
- Thinnest thread, cheapest per run, one vendor to debug.

**Cons**:
- No unit normalisation (a rate per 200 000 hours next to one per 1 000 000 hours), no independent support check, no conflict rule; the benchmark in feature 9 inherits every parsing slip.
- The AI module in `src/lib/ai/` stays unbuilt until feature 9, so the first model call lands together with the cost model, a worse place to learn the gateway.

### Option 4: Own search plus a Claude tool loop

A search API (Parallel Search, Exa, Tavily) plus a Claude agent that searches, reads pages and extracts, orchestrated in the task.

**Pros**:
- Maximum control over what is read and how; the reasoning is ours to log.

**Cons**:
- The most code, the longest runs, and it reopens spec 0001's vendor decision; page reading, PDF parsing and rate limits become our problem.
- Hard to bound in cost per run; a tool loop on a thinly documented company can search for a long time.

## Rationale

Option 1 wins on the forces that matter: the tiny team, the per run cost, and the need for cited values. Spec 0001 already put the research on Parallel and every model call on the AI SDK (basis: spec 0001, the AI and company research rows); using Parallel's structured output keeps the citation per value, which Option 2 loses, and adding the Claude pass closes the normalisation and support gap that Option 3 leaves open for the benchmark to trip on (basis: validate at the boundary, your `AGENTS.md` rules). Option 4 is the most flexible and the least bounded; a funnel step with a hard cost per sign up needs a bounded run, not an open loop.

The smaller calls follow the same lens. **Polling with `wait.for`** over a webhook: Trigger.dev Cloud charges no compute during the wait and the run keeps a single durable id, whereas a webhook needs a public route, a signature check and a second failure path (basis: the Trigger.dev docs on `wait` and `maxDuration`, verified). Resume by `provider_run_id` is what makes the retry safe: the id is written before the first poll, so a retry never pays twice (basis: idempotency for external side effects). **The quota in the database** rather than the action: a policy plus a partial unique index is the one design where a second tab or a direct insert through the anon key cannot start a duplicate paid run, and pgTAP can prove it (basis: spec 0002, RLS as the real boundary). **The fixture provider** rather than record and replay: a canned result keyed by name is deterministic, holds no third party text in the repo, and lets Playwright drive the whole thread the way the welcome email test does (basis: spec 0006's `TRIGGER_DEV_RUNNING` pattern). **Store unvalidated values on a validation outage** rather than fail: the research succeeded and the client is waiting; a capped confidence and a visible mark are honest, a failed run is not. **Flat output fields** rather than nested arrays: the provider cites per top level field, and flat string fields with instructions in the description are the documented enrichment shape (basis: the Parallel task quickstart, verified; the exact basis field names are unverified and left to build time). **The AI SDK current major (v7)** rather than the v6 spec 0001 named: nothing was installed yet, and a greenfield module on a superseded major is a migration within months (basis: the AI SDK docs marking `generateObject` deprecated, verified). **Name plus optional website** rather than a Zefix type ahead: the website is the strongest research anchor and needs no vendor; Zefix is a cheap follow up once ops report wrong matches (basis: the Zefix public REST docs, verified).

Recommendations settled while writing (each with its runner up): the provider output schema is flat, three string fields per KPI plus the company facts (runner up: nested arrays); confidence thresholds 0.75 and 0.4 for the badge (runner up: three equal bands); the task polls every 15 seconds with a 20 minute budget from `started_at` (runner up: 30 seconds and 30 minutes); `maxDuration` 900 seconds of compute, queue concurrency 5, 3 attempts (runner up: the project defaults); the conflict rule prefers the company's own domain, then the higher confidence (runner up: newest source); the stale limits are 30 minutes queued and 60 minutes running (runner up: a single 45 minute limit); the alert carries the Trigger.dev run URL through a new optional `externalUrl` (runner up: relax the `link` regex to allow absolute URLs); no PostHog events yet (runner up: two ad hoc events now, renamed by feature 15).

## Cross check (2026-09-06)

A read only pass on another model (Opus) judged the design sound with gaps and the engineer chose to apply the recommended fixes. The load bearing ones: clients had no update right on `research_runs`, so the action could not store the trigger id or mark a failed trigger (fixed by the narrow members update policy with column grants in AC-2); the sweep could race a live attempt and a resumed attempt could end `empty` (fixed by status guarded terminal writes and the row count rule in AC-6, AC-10 and AC-11); and the flat provider schema rests on an unverified per field basis (fixed by the spike that opens slice 2). The rest were unsourced values (the website rule, the quota count rule, the years shown, number formats, the alert idempotency keys, the fixture constants, the Claude output schema) that are now named in the acceptance criteria and the value sourcing table.

## Landscape and tool checks (2026-09-06)

Run once in read only helpers before the stack questions. Full notes: `docs/.agent-cache/research/company-research-pipeline.md` and `docs/.agent-cache/tool-discovery/company-research-pipeline.md`.

| Fact | Result | Verified |
|---|---|---|
| Parallel TypeScript SDK | `parallel-web`, major 1 | yes (docs.parallel.ai) |
| Parallel output schema | passed as `{ type: 'json', json_schema }` | yes |
| Parallel processors | `base`, `core`, `ultra` confirmed; `lite` and `pro` not found in the fetched pages | partly |
| Parallel per field basis (citations, confidence, reasoning) | not confirmed in the fetched pages | no, verify at build time |
| Parallel waiting modes | blocking result with `api_timeout`, polling, webhooks, SSE | yes |
| Parallel EU processing option | nothing found | no |
| AI SDK current major | v7, `generateText` with `Output.object`, `generateObject` deprecated | yes |
| AI Gateway key setup from a non Vercel runtime | not reached in the fetched pages | no, `AI_GATEWAY_API_KEY` per spec 0001 |
| Trigger.dev `wait.for` | no compute while waiting on Cloud; excluded from `maxDuration` | yes |
| Zefix public REST | exists, free account with basic auth | yes |
| Agent skills | `parallel-web/parallel-agent-skills` (official, CLI and Task API conventions); the installed `vercel/ai` skill remains the best AI SDK skill; one tiny community Zefix skill, not offered | installed three Parallel skills |
| MCP servers | Parallel Task MCP (official) chosen, to connect; Parallel Search MCP (official, free) declined for now | not connected yet |

## References

**Project sources** (verifiable, in this repo):
- `AGENTS.md`: the rules (functional style, one error pattern, validate at the boundary, the four client factories, service client only in `src/trigger/`), the Trigger.dev, Supabase and AI SDK skills.
- Spec 0001: Parallel for company research, the AI SDK through the AI Gateway on `anthropic/claude-sonnet-5`, per organization quotas in Postgres, the DPA list.
- Spec 0002: `companies`, `research_runs` (state machine, Realtime), `company_kpis`, `company_kpi_current`, the tenant table contract.
- Spec 0005: the organization claim in the session (`organizationIdFromClaims`).
- Spec 0006: the `ops-alert` task and the reserved `research.run_failed` kind, the `TRIGGER_DEV_RUNNING` Playwright pattern, the idempotency key convention.
- `docs/design.md`: the state patterns (loading, empty, error, progress), the component inventory, the gallery rule for new primitives.
- Installed skills: `trigger-tasks`, `ai-sdk`, `parallel-data-enrichment`, `parallel-deep-research`, `parallel-cli-setup`, `supabase`, `supabase-postgres-best-practices`.

**Practices & standards**:
- Idempotency for external side effects (the provider run id written before the first poll, the task keyed by run id).
- Validate at the boundary (every provider and model output parsed by Zod before it is stored).
- Row level security as the real boundary (the quota and the open run rule enforced in Postgres, proven by pgTAP).
- Design for failure (retry, resume, degrade with a visible mark, sweep the stuck).
- Data minimisation under the FADP (only public company identifiers leave the platform).

**Links** (web verified on 2026-09-06 by the landscape check; for a human to follow, never fetched again by a later step):
- Parallel Task API quickstart (SDK, output schema, processors): https://docs.parallel.ai/task-api/task-quickstart
- Parallel on waiting for results (blocking, polling, webhooks): https://parallel.ai/blog/webhooks
- Parallel MCP server quickstart: https://docs.parallel.ai/integrations/mcp/quickstart
- AI SDK structured output (`Output.object`, `generateObject` deprecated): https://ai-sdk.dev/docs/ai-core/generate-object
- Trigger.dev `maxDuration` and waits: https://trigger.dev/docs/runs/max-duration
- Zefix public REST API (Swagger): https://www.zefix.admin.ch/ZefixPublicREST/swagger-ui/index.html
