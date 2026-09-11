# 0017. Analytics & monitoring

**Date**: 2026-09-11
**Status**: Accepted

## Summary

The app already sends events to PostHog and errors to Sentry, but the events were named one at a time as each feature shipped, so two of them disagree about how a name is spelled and nothing checks that a new one carries the properties a funnel needs. This spec fixes the vocabulary rather than the plumbing: one typed catalogue names every event and the properties it must carry, the ten Release 1 events are captured from the server wherever the server can see them, and two gaps on the monitoring side get closed (a failed background job now reaches Slack, and an error now says which deploy it came from). The funnel itself stays in PostHog as a saved insight, written down in a runbook rather than rebuilt as a page.

## Requirements

**User stories**:
- As the owner, I want to see how many visitors reach each step of the free to paid loop, so I know where people give up.
- As the owner, I want every event to carry the company and the language, so I can tell a German pilot client's behaviour from an English one's.
- As an engineer, I want a wrong event name to fail the typecheck, so the vocabulary cannot drift again.
- As ops, I want a failed background job to reach Slack with enough detail to reproduce it, so a silent failure cannot sit unnoticed.

**Acceptance criteria**:

- **AC-1**: Every analytics event name in the app comes from one exported list, `ANALYTICS_EVENTS` in `src/lib/analytics/catalogue.ts`. The names follow `object.verb_past` with a dot, matching `ALERT_KINDS`. `captureServerEvent` accepts only a name from that list, so passing a free string is a typecheck failure.
- **AC-2**: Each event declares its properties as a Zod schema in the same catalogue, in a `Record<AnalyticsEvent, z.ZodType>` shape with a `satisfies` check, so adding a name without a schema fails the typecheck. `captureServerEvent` parses the properties against the event's own schema before sending, and a parse failure is logged and dropped rather than thrown.
- **AC-3**: An event fired by a signed in person requires `organizationId` and `locale` in its schema. An event that happens before an account exists requires `locale` only and declares no `organizationId`, so no call site invents a placeholder.
- **AC-4**: `distinctId` is the Supabase auth `sub` for every event fired by a signed in person. No identifier cookie is written before the visitor answers the cookie bar, so no server event before sign up is tied to a person; such an event uses the entity id it already has and is not stitched.
- **AC-5**: Nine events are captured server side and never depend on consent: `lookup.started`, `research.finished`, `benchmark.computed`, `kpi.client_saved`, `kpi.client_cleared`, `checkout.started`, `payment.completed`, `enquiry.sent`, `expert.profile_completed`.
- **AC-6**: `benchmark.viewed` is captured in the browser through the consent gated path, because a server render is not a human view. It fires once per dashboard visit that shows a snapshot, and not at all when consent is absent or denied.
- **AC-7**: The two events live today are renamed: `enquiry_sent` becomes `enquiry.sent`, and `expert_onboarded` becomes `expert.profile_completed` rather than `expert.onboarded`, because that exact string is already an `ALERT_KINDS` entry and one name must not mean both an alert and an event. `ENQUIRY_SENT_EVENT` in `src/features/marketing/actions.ts` is deleted, its name coming from the catalogue instead.
- **AC-8**: Capture never blocks or breaks the caller. A server action fires its event after its own work has succeeded, an analytics failure never changes the action's typed result, and a failure is logged through `log` with the event name. In a task, the event fires **after** the write that makes the work durable and idempotent, never before it, so a retried attempt that crashed mid run cannot emit a second event for one logical run. `benchmark-company` retries up to three times, so `benchmark.computed` fires after the snapshot insert, and `research.finished` after the terminal status write.
- **AC-9**: `tasks.onFailure` in `src/trigger/instrumentation.ts` sends a `task.failed` ops alert alongside the existing Sentry capture, carrying the task id, the run id, the attempt count and the error message. `task.failed` is added to `ALERT_KINDS` with its typed fields and a presenter, per `docs/email.md`. The alert is best effort: a failed alert never masks the original task failure.
- **AC-10**: Sentry tags every event with a release, taken from the Vercel commit SHA, and uploads source maps at build time, so a production stack trace names real files and lines and an error says which deploy it came from.
- **AC-11**: `docs/analytics.md` exists and holds the taxonomy table (every event, where it fires, its properties, server or browser), the recipe for the Release 1 funnel insight in PostHog naming the ordered steps and the `locale` breakdown, and the per environment checklist.
- **AC-12**: A Vitest suite asserts the catalogue is internally consistent: every name has a schema, every schema requires `locale`, and no name breaks the dotted convention. A second suite proves `captureServerEvent` drops an event whose properties fail the schema and returns without throwing.

## Decision

**Chosen option**: Option 1: fix in place, a typed catalogue over the existing capture functions.

One catalogue module names every analytics event and the properties it must carry, `captureServerEvent` accepts only those names and validates the properties, the ten Release 1 events fire server first with the browser used only for the genuine view event, and the two monitoring gaps are closed in the instrumentation files that already exist.

**Implementation skills**: `posthog-instrumentation` (`posthog/posthog-for-claude`, `.claude/skills/posthog-instrumentation/`) · `trigger-authoring-tasks` (`triggerdotdev/skills`, `.claude/skills/trigger-authoring-tasks/`) · `vitest` (`antfu/skills`, `.claude/skills/vitest/`)

## Feature design

**Data model sketch**:

No schema change. This feature writes no table and adds no column. The events go to PostHog and the alerts to Slack, both external. `ALERT_KINDS` gains the string `task.failed`, which is a TypeScript constant, not a database enum.

**The event catalogue** (`src/lib/analytics/catalogue.ts`), the target shape:

| Event | Fired from | Side | Required properties |
|---|---|---|---|
| `lookup.started` | `requestResearch`, after the company and run rows insert | server | `organizationId`, `locale`, `companyId`, `runId` |
| `research.finished` | `research-company` task, at the terminal status | server | `organizationId`, `locale`, `runId`, `status`, `kpiCount`, `provider`, `durationMs` |
| `benchmark.computed` | `benchmark-company` task, after the snapshot insert | server | `organizationId`, `locale`, `companyId`, `triggerKind`, `kpisCompared`, `modelVersion` |
| `benchmark.viewed` | a small client child of `BenchmarkSegment` (which is itself a server component) | browser | `organizationId`, `locale`, `companyId`, `snapshotId` |
| `kpi.client_saved` | `saveClientKpis`, after the write | server | `organizationId`, `locale`, `companyId`, `kpiKeysSent`, `reportingYear` |
| `kpi.client_cleared` | `clearClientKpi`, after the delete | server | `organizationId`, `locale`, `companyId`, `kpiKey` |
| `checkout.started` | `startCheckout`, after the session id write is confirmed | server | `organizationId`, `locale`, `orderId`, `packageKey`, `grossRappen` |
| `payment.completed` | `settleOrder`, after the settle RPC succeeds | server | `organizationId`, `locale`, `orderId`, `packageKey`, `grossRappen`, `invoiceNumber` |
| `enquiry.sent` | `submitEnquiry`, after the row insert | server | `locale`, `topic` (no organization: the sender may be anonymous) |
| `expert.profile_completed` | `updateExpertProfile`, on the save that flips the status to `active` | server | `locale` (no organization: an expert belongs to none) |

`locale` is the short code `de` or `en`, matching `docs/localization.md`.

**State transitions**:

None. Events are append only facts with no lifecycle.

**API surface**:

No HTTP endpoint is added. The interface is two functions.

| Function | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| `captureServerEvent` | server call | `{ distinctId, event: AnalyticsEvent, properties }` typed per event | `Promise<boolean>` (false when unconfigured or the properties fail to parse) | caller already authorised | never throws; logs and returns false |
| `captureBrowserEvent` | browser call | `{ event, properties }` | `void` | consent gated | no op without a loaded PostHog |

**Value sourcing**:

| Action | Value produced / displayed | Source |
|---|---|---|
| `lookup.started` | `distinctId` | `actor.userId` from `requireClient()` |
| `lookup.started` | `organizationId` | `actor.organizationId` from `requireClient()` |
| `lookup.started` | `companyId`, `runId` | the ids returned by the inserts already in `requestResearch` |
| `lookup.started` | `locale` | `localeOf(input)`, already parsed by the action |
| `research.finished` | `distinctId` | `created_by` on the `research_runs` row the task already loads |
| `research.finished` | `status`, `kpiCount` | the task's own terminal state and the count of rows it wrote |
| `research.finished` | `provider` | `RESEARCH_PROVIDER`, per `docs/research.md` |
| `research.finished` | `durationMs` | the run row's `created_at` subtracted from the task's own clock at the terminal write |
| `research.finished` | `locale` | `localeForUser` in `src/features/localization/queries.ts`, the same helper `send-email` already uses; the column is `profiles.locale` |
| `benchmark.computed` | `distinctId` | `companies.created_by`. The task does not read this column today, so the build adds it to the existing company select rather than issuing a second query |
| `benchmark.computed` | `triggerKind` | the task payload's existing `triggerKind` field |
| `benchmark.computed` | `kpisCompared` | `body.kpisCompared`, the value the task already computes and writes to the row. Not `results.length`: the two can differ |
| `benchmark.computed` | `modelVersion` | `MODEL_VERSION` from `src/features/benchmark/catalogue.ts` |
| `benchmark.viewed` | `distinctId` | PostHog's own consented browser id; never a server supplied value |
| `benchmark.viewed` | `snapshotId`, `companyId` | already props of `BenchmarkSegment` at the call site in the dashboard page |
| `benchmark.viewed` | `organizationId` | computed in the dashboard page but not currently passed down, so the build plumbs it into the new client child |
| `kpi.client_saved` | `kpiKeysSent` | the `sent` array `saveClientKpis` already builds: the keys **present** in the submission, which is not the same as the keys whose value changed. The property is named `kpiKeysSent` so the funnel cannot be misread as counting edits |
| `kpi.client_saved` | `reportingYear` | the year the form resolved through `years.ts`, per spec 0010 |
| `checkout.started` | `orderId`, `packageKey`, `grossRappen` | the inserted `orders` row, whose amounts `computeAmounts` produced |
| `payment.completed` | `invoiceNumber` | the gapless number the `settle_order` RPC returns |
| `payment.completed` | `distinctId` | the order's `created_by`. `settleOrder` does not read it today and its `SettleResult` does not carry it, so the build selects `created_by`, `organization_id` and `locale` from the order in the webhook path before firing |
| `payment.completed` | `locale` | `orders.locale`, the existing not null column; never a request header, because the webhook is a Stripe call rather than the buyer's browser |
| `enquiry.sent` | `distinctId` | the enquiry id, unchanged from today; an enquirer may have no account, per AC-4 |
| `task.failed` alert | `taskId`, `runId`, `attempts`, `error` | the `ctx` and `error` the `onFailure` hook already receives |
| Sentry event | `release` | `VERCEL_GIT_COMMIT_SHA`, set by Vercel at build |

**Key invariants**:

- An event name that is not in `ANALYTICS_EVENTS` cannot be passed to `captureServerEvent`; the type system is the enforcement, not review.
- Every event schema requires `locale`. Every event fired by a signed in person also requires `organizationId`.
- No analytics failure ever changes a server action's typed result, and no analytics call throws into a caller.
- No identifier is written to the browser before the consent bar is answered. `benchmark.viewed` is the only event that may be absent for a real user, and it is absent by design when consent is denied.
- A `task.failed` alert failure never masks the task failure that caused it.

**Security model**:

Events carry ids and codes, never personal content. No email address, no contact name, no company name and no free text message is ever an event property; `enquiry.sent` carries the topic code and the locale, not the message. This mirrors the rule already stated in `src/lib/alerts/schema.ts`, that Slack gets names and company names only, and keeps PostHog outside the set of processors holding contact data. `organizationId` and `companyId` are opaque UUIDs, useless without database access. PostHog remains in its EU region, and its entry in `PROCESSORS` in `src/features/legal/processors.ts` is reviewed against the new server side capture, because the record of processing must say that some analytics events are collected without consent on the legitimate basis of the product recording its own work. Compliance scope is the revised FADP with GDPR readiness, as for the whole product; this feature does not add a new category of personal data.

**Configuration required**:

- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`: already present, no change.
- `SENTRY_AUTH_TOKEN`: new, needed at build time to upload source maps.
- `SENTRY_ORG`, `SENTRY_PROJECT`: new, needed by the Sentry build plugin.
- `VERCEL_GIT_COMMIT_SHA`: provided by Vercel, read not set.
- The Slack webhook for `task.failed` is the existing one; no new secret.

**Critical test scenarios**:

- Happy path: a signed in client runs a lookup, and `lookup.started` reaches PostHog with the organization, locale, company and run ids, verifies **AC-1**, **AC-3**, **AC-5**.
- Catalogue consistency: every name in `ANALYTICS_EVENTS` has a schema, every schema requires `locale`, and no name breaks the dotted convention, verifies **AC-1**, **AC-2**, **AC-12**.
- Failure case: `captureServerEvent` is called with properties missing a required field; it logs, returns false and does not throw, and the calling action still returns `{ ok: true }`, verifies **AC-2**, **AC-8**, **AC-12**.
- Failure case: PostHog is unconfigured (no key, the local default); every capture returns false and no call site changes behaviour, verifies **AC-8**.
- Consent case: with no consent answer and with a denied answer, no `benchmark.viewed` request leaves the browser; after accepting, it fires once on the dashboard, verifies **AC-6**.
- Consent case: no identifier cookie is written before the bar is answered, checked in Playwright by inspecting the cookie jar on first paint, verifies **AC-4**.
- Failure case: a task throws past its retries and a `task.failed` alert reaches the Slack catcher carrying the task id, run id and error, while Sentry still receives the exception, verifies **AC-9**.
- Auth/permission: an ops or expert user submitting the enquiry form produces an `enquiry.sent` with no `organizationId`, matching the anonymous rule already in `submitEnquiry`, verifies **AC-3**.

## Build plan

Tracer Bullet, so milestone 1 proves the whole vocabulary end to end through one event before the other nine are added. The riskiest question here is whether a typed catalogue with per event property schemas is pleasant to use at a real call site, and that is answered by one event reaching a real PostHog insight, not by nine.

1. The catalogue and one event end to end: `src/lib/analytics/catalogue.ts` with `ANALYTICS_EVENTS`, the per event Zod schemas under a `satisfies Record<AnalyticsEvent, z.ZodType>` check, and the `AnalyticsEvent` type; `captureServerEvent` retyped to accept only a catalogue name and to parse the properties before sending, logging and returning false on a parse failure; `enquiry_sent` renamed to `enquiry.sent` with `ENQUIRY_SENT_EVENT` deleted and the call moved after the insert; proven by seeing the event and its properties land in PostHog, satisfies **AC-1**, **AC-2**, **AC-3**, **AC-7**, **AC-8**.
2. The server side funnel: capture calls added at `requestResearch`, the `research-company` and `benchmark-company` tasks, `saveClientKpis`, `clearClientKpi`, `startCheckout`, `settleOrder`, and `expert_onboarded` renamed to `expert.profile_completed`. Each fires after the write that makes its work durable, never before. Three call sites need a value they do not read today and the build adds each to an existing query rather than a new one: `companies.created_by` in `benchmark-company`, `localeForUser` in `research-company`, and `created_by` with `organization_id` and `locale` on the order in the Stripe webhook path, satisfies **AC-4**, **AC-5**, **AC-7**, **AC-8**.
3. The one browser event: `captureBrowserEvent` behind the existing consent gate, and `benchmark.viewed` fired once per dashboard visit that shows a snapshot. `BenchmarkSegment` is a server component, so this is a small client child that takes the ids as props and fires on mount; `organizationId` is plumbed to it from the dashboard page, which computes it but does not currently pass it down. Playwright proves that neither the event nor any identifier appears before a consent answer, satisfies **AC-4**, **AC-6**.
4. Monitoring: `task.failed` added to `ALERT_KINDS` with its typed fields and presenter, fired from the existing `tasks.onFailure` hook beside the Sentry capture and best effort; the Sentry release set from `VERCEL_GIT_COMMIT_SHA` and source map upload wired into the build, satisfies **AC-9**, **AC-10**.
5. Tests and the runbook: the catalogue consistency suite and the capture failure suite in Vitest, the consent Playwright spec, `docs/analytics.md` with the taxonomy table, the funnel insight recipe and the per environment checklist, and the `PROCESSORS` review for the server side capture basis, satisfies **AC-11**, **AC-12**.

## Consequences

**Positive**:
- The funnel is complete for every client regardless of the cookie answer, which for a Swiss B2B audience is the difference between a usable funnel and a biased one.
- A wrong event name or a missing property fails the typecheck, so the drift this spec cleans up cannot recur.
- Specs 0008, 0009 and 0010 all lose their open analytics follow ups in one pass, so no spec is left owing an event.
- Every background task, including tasks not yet written, gets Slack alerting on failure for free through the hook that already exists.
- A production stack trace becomes reproducible: it names real files and says which deploy it came from.

**Negative / tradeoffs**:
- Person level attribution before sign up is deliberately given up. The visitor to sign up step is measured only through the consented browser id, so it undercounts, and the spec states that rather than hiding it.
- `benchmark.viewed` undercounts by the consent rejection rate, so it must never be compared directly against the server side steps around it without saying so. This is the one place a reader of the funnel can fool themselves, and the runbook has to say it out loud.
- The catalogue is a file that must be updated whenever a feature adds an event, and a feature that simply forgets to fire one is still invisible to the type system.
- Renaming two live events discards their small staging history; the numbers before and after the rename cannot be joined in PostHog.
- Source map upload adds a build step and a new auth token to manage, and it slows the build slightly.

**Neutral**:
- No database migration, no RLS change and no pgTAP file; this is the rare feature that touches no schema.
- The funnel lives in PostHog rather than the app, so reading it needs a second login until feature 24 builds the ops metrics dashboard.
- `docs/analytics.md` becomes the seventh runbook, and `AGENTS.md` gains a rule pointing at it, which `/sync` will add.

## Migration plan

**Strategy**: feature flagged is not needed; this is a rename plus additions, delivered in one deployment per milestone.

**Phases**:
1. Add the catalogue and retype `captureServerEvent`. The two existing call sites are updated in the same commit, because the new type will not accept the old names. Nothing is dual written: PostHog accepts any name, so the old and new names simply coexist in history.
2. Add the eight new capture calls. Each is additive and independently revertible.
3. Add the `task.failed` alert kind and the Sentry release wiring, both additive.

**Rollback**: every milestone reverts by reverting its commit. No data is transformed and no schema changes, so there is no backfill to undo. The only irreversible part is that events already sent under the old names stay under the old names in PostHog, which is history, not state.

**Risks**:
- A capture call placed before its action's own work would fire an event for work that then failed, which is why the build plan states the ordering explicitly for every call site.
- The `task.failed` alert could become noisy if a task retries loudly; it fires from `onFailure`, which runs once after retries are exhausted, not per attempt, and that is the reason `onFailure` is named rather than `catchError`, matching the rule already in `AGENTS.md`.

## Follow-up

- [ ] Feature 24 (ops metrics dashboard) should surface the funnel in app, so reading it does not need a second login.
- [ ] Decide whether marketing entry events (`pricing.viewed`, `package.selected`) are worth adding once the funnel shows real drop off; they were considered and deferred here because they are browser only and therefore the least reliable events in the set.
- [x] Review the PostHog entry in `PROCESSORS` and the record of processing, so the record says that some events are collected server side without consent and on what basis. Done in milestone 5: both surfaces claimed PostHog "loads only after the visitor accepts", which the nine server side events made false. The record now states the two paths and their two bases (`interest` for the server events, which set no device identifier, `consent` for `benchmark.viewed`), and the privacy page's `posthog.purpose` says the same in both catalogues. `PROCESSORS` itself needed no row change: PostHog was already listed, in the EU.
- [x] `docs/analytics.md` conventions are not yet in root `AGENTS.md`; `/sync` should add the one line rule pointing at it. Added by `/sync` on 2026-09-11, in the `## Rules` list beside the other runbook rules.
- [ ] Confirm whether Sentry `tracesSampleRate` should rise above 0 for slow page reporting, which the scope row names but this spec does not build.


## Rationale

Reasoning and options: see [rationale.md](rationale.md).
