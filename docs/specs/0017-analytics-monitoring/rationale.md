# 0017. Analytics & monitoring, rationale

The decision record behind [index.md](index.md). `/develop` does not need this file.

## Context

> ⚠️ Premise note: the scope row reads as though analytics and monitoring are unbuilt, and the code says otherwise. `src/lib/analytics/server.ts` sends server side events to PostHog today, `client.tsx` holds a consent gated browser loader that spec 0015 verified against a real deployment, and Sentry runs in the web app, in the request error hook and in every Trigger.dev task. Treating this as a greenfield build would mean rewriting working, compliance verified code. What is actually missing is a vocabulary and the discipline to keep it: only four events exist, two of them disagree about how a name is spelled, and nothing checks that a new one carries the properties a funnel needs. This spec is therefore written as an enhancement to the naming and coverage of an existing system, not a new feature.

SME24 sells a free to paid loop: a company looks itself up, waits for an AI research run, reads a peer benchmark with a CHF figure, and then buys a fixed price package. Release 1 exists to prove that loop converts, and nobody can currently say where people give up. The steps are all in the code and all leave database rows, but no step records a comparable event, so the question "how many companies that saw a benchmark started a checkout" cannot be answered without writing SQL against four tables and guessing at the join.

Four events exist today and they were each added by the feature that needed them, one at a time. `enquiry_sent` came with the marketing site and spec 0009 flagged its own name as provisional, to be confirmed or renamed here. `expert_onboarded` came with expert accounts. Two more sit in the scaffold feature. Meanwhile specs 0008 and 0010 closed with written promises of events that were never built: `benchmark.viewed` and `benchmark.computed` with named properties, and `kpi.client_saved` and `kpi.client_cleared`. Those promises used dotted names; the shipped events used underscores. So the vocabulary is already inconsistent at four events, and three specs are carrying open follow ups that point at this feature.

The forces that shape the answer are mostly about consent and about who buys. Spec 0015 built a strict cookie gate: nothing non essential loads or is stored before the visitor answers the bar, the answer is versioned, and withdrawal clears PostHog's storage directly. That gate is verified and lawyer adjacent, so it is not something to loosen casually. At the same time the buyers are Swiss regulated companies, an audience that rejects cookies at a high rate and not at random, which means a browser only funnel would systematically miss the most conservative and most valuable prospects. Server side capture avoids the problem entirely for anything the server can see, but it collides with consent at exactly one point: identifying a visitor before they have an account requires storing an id, and an analytics id is not essential by any honest reading of the rule.

On the monitoring side the gap is narrower and more operational. Every task failure already reaches Sentry through a global `tasks.onFailure` hook, but only two domains, research and benchmark, raise a Slack alert, so a failure in `send-email`, `purge-enquiries` or `render-invoice` is silent unless somebody opens a dashboard. And Sentry has no release configured, so a production stack trace is minified and cannot be tied to a deploy, which is precisely the "enough context to reproduce" bar the scope row sets.

The consequence of not deciding is that the vocabulary keeps drifting one feature at a time, each new event inventing its own convention, until the funnel is built on names that cannot be compared and properties that are present on some events and absent on others.

## Options considered

### Option 1: Fix in place, a typed catalogue over the existing capture functions

Keep `captureServerEvent` and the consent gated `AnalyticsProvider` structurally as they are, and add a catalogue module in front of them that constrains the name and validates the properties. Rename the two drifted events, add capture calls at the eight uninstrumented sites, and close the two monitoring gaps in the files that already exist.

**Pros**:
- The plumbing works and the hard part, not loading before consent, is already proven on a real deployment. None of it is touched.
- The typed catalogue mirrors `ALERT_KINDS` and `alertFields` exactly, so events and alerts share one mental model.
- The rename is cheap now and only gets more expensive; PostHog holds test traffic only, so almost nothing is lost.

**Cons**:
- The per call PostHog client stays, costing a few tens of milliseconds per event.
- A catalogue is one more file to keep in step, and the type system constrains the name, not whether anyone remembered to fire the event.

### Option 2: Route every event through a Trigger.dev task

Add a `capture-event` task and have every call site trigger it, so the request never waits and a failed send retries on its own.

**Pros**:
- Retries are free and a transient PostHog outage loses nothing.
- Matches the email and alert rails, so every outbound side effect leaves through the same door.

**Cons**:
- A task run per event is real money, and events are by far the highest volume side effect in the product.
- It buys delivery guarantees for data that is inherently statistical and lossy. Paying task pricing to guarantee a funnel step is a poor trade.
- It adds a hop that makes a missing event harder to debug rather than easier.

### Option 3: Write the convention down and rely on review

Document the taxonomy in `docs/analytics.md` and leave `captureServerEvent` taking a plain string.

**Pros**:
- No new code, total flexibility, nothing to keep in step.

**Cons**:
- This is the enforcement level that produced the current drift: two events shipped, two conventions, both by careful authors.
- A misspelled name is invisible until someone builds a funnel and finds an empty step, long after the deploy that caused it.

## Rationale

The typed catalogue wins over a documented convention because this project has already run that experiment and it failed. `enquiry_sent` and `expert_onboarded` were each added by an author following the same unwritten rule, and they still disagree with what specs 0008 and 0010 promised. The catalogue also matches the shape the codebase already uses for alerts, which is the strongest argument available: a pattern the team has operated across five features beats a theoretically better pattern nobody has run. The cost is one more file that must stay in step, and a `satisfies Record<AnalyticsEvent, z.ZodType>` check keeps it honest without ceremony.

Server first capture is the decision with the most consequence, and it follows from who the buyer is. A Swiss B2B audience rejects cookies at a high and non random rate, so a browser only funnel would miss exactly the conservative regulated companies this product targets, and the resulting conversion numbers would be biased in a direction that flatters nobody. Firing state changing events from the server makes the funnel complete regardless of the cookie answer, and it is defensible under the revised FADP because a server side event tied to an existing account is the product recording its own work, not tracking a visitor across the web. The one event that cannot be honest server side is the dashboard view, because a server render also happens on a prefetch, a refresh and a bot, so that one stays in the browser behind the consent gate, and the runbook has to say plainly that its number is smaller than the steps around it.

The identity rule resolved a genuine conflict rather than papering over it. Server first capture wants a stable id for a visitor before they sign up; that id is a cookie; spec 0015 AC-1 forbids storing anything non essential before the bar is answered. Rather than amend a lawyer gated area for a marginal gain, person level stitching begins at the account. Before sign up, server events carry the entity id they already have and are not tied to a person, and the visitor to sign up step is measured through the consented browser id only. This is a deliberate and stated loss of fidelity at the very top of the funnel, accepted because the alternative reopens a compliance decision that feature 26 gates on a lawyer's pass, for a step that matters less than the paid conversion below it.

A cross check challenged whether the per event property schemas earn their keep, given that the typed union already catches a wrong name at compile time and a parse failure only drops the event. They do, for two reasons the type system cannot cover. First, most properties here are strings and numbers, so the compiler cannot tell `companyId` from `organizationId` when both are `string`, and a transposed pair would silently produce a funnel that breaks down by the wrong dimension. Second, several values arrive from a database row or a task payload typed as `string | null` or `Json`, where the compiler is satisfied and the value is still absent at runtime. The schema turns both into a logged drop rather than a quietly wrong chart, and dropping is the right failure for analytics: a missing event is visible as a gap, while a wrong event is believed. The cost is one Zod object per event in a file that already has to list every event anyway.

Keeping the per call PostHog client is right for a serverless runtime even though it looks wasteful. A reused module level client buffers events in memory, and a Vercel function can freeze or be reclaimed between invocations, so buffered events are lost precisely when traffic is bursty and the data matters most. The latency objection is real but is solved by ordering rather than pooling: fire the event after the action's own work has succeeded and never let its failure reach the caller, the same shape `submitEnquiry` already uses for its alert and its email. That also preserves the `AGENTS.md` rule that a server action returns a typed result and never throws for an expected failure.

On monitoring, the honest diagnosis is that Sentry is wired but under configured, so the fix is configuration rather than construction. A generic `task.failed` alert kind in the `onFailure` hook that already exists closes the silent failure gap for every task at once, including tasks not yet written, which is a much better return than adding a per domain alert to each task by hand. It fires from `onFailure` rather than `catchError` precisely so it runs once after retries are exhausted rather than on every attempt, which is the rule spec 0011 already established. The release and source map gap is smaller but blocks the scope row's own stated bar, since without a release tag a minified production trace cannot be tied to a deploy.

The funnel view stays in PostHog on purpose. PostHog builds funnels natively from well named events, with cohorts and breakdowns included, and feature 24 is already scoped to build the ops metrics dashboard. Building a chart now would duplicate that feature and put a PostHog API key on the server for a view the tool gives away. The deliverable is therefore the correct events plus a runbook naming the exact insight to create, which is what makes the events useful rather than merely present.

## References

**Project sources**:
- `AGENTS.md`, the typed result rule for server actions and the `onFailure` rather than `catchError` rule from spec 0011.
- Spec 0015 (`docs/legal.md`), the consent gate, `CONSENT_VERSION` and the rule that nothing non essential is stored before an answer.
- Specs 0008, 0009 and 0010, which each closed with a named analytics follow up pointing at this feature.
- `src/lib/alerts/schema.ts`, the `ALERT_KINDS` plus typed fields pattern this catalogue mirrors, including its rule that a recipient's email address is never an alert field.
- `src/lib/analytics/server.ts` and `client.tsx`, the existing capture paths this spec keeps.
- The `posthog-instrumentation` community skill, server capture first with the browser gated by consent.

**Practices & standards**:
- Server side capture for state changing events, so measurement does not depend on client consent or ad blockers.
- Strangler instinct applied to a vocabulary: rename at the boundary, let old and new names coexist in history rather than backfilling.
- Releases and source maps as the precondition for a reproducible production stack trace.
- The revised Swiss FADP with GDPR readiness, the product's standing compliance scope.
