# Analytics and monitoring

_How a visitor's journey becomes a readable funnel, and how a failure reaches a human (spec [0017](specs/0017-analytics-monitoring/index.md)). The code lives in `src/lib/analytics/` (the catalogue, the server capture, the consent gated browser gate), `src/trigger/instrumentation.ts` (the task failure alert and the Sentry hooks) and the call sites named in the table below. This file is the runbook: the taxonomy, the funnel recipe, the consent split and the per environment checklist._

## The two paths, and why

Events reach PostHog two ways, and the difference is the whole compliance and accuracy story.

**Server side, nine events, no consent needed.** These record SME24's own work on an account: a lookup was started, a research run finished, a payment completed. They are captured from a server action, a route handler or a Trigger.dev task, they set nothing on the visitor's device, and they carry opaque ids rather than a name, an email address or any text a person wrote. Because they need no browser storage they are not a cookie question, and they fire whether or not the visitor accepted analytics. For a Swiss B2B audience, where rejection rates are high, this is the difference between a usable funnel and a biased one.

**Browser side, one event, consent only.** `benchmark.viewed` is a genuine human view, and a server render is not: a prefetch, a refresh and a bot all render. It can therefore only be counted in the browser, which needs the `ph_*` cookie, which needs acceptance. It is absent by design for anyone who denied.

The consequence is stated here because it is the one place a reader of the funnel can fool themselves: **`benchmark.viewed` undercounts by the consent rejection rate, and must never be compared directly against the server side steps around it without saying so.** Read it as its own trend over time, not as a conversion rate from the step before it.

## The taxonomy

Every name lives in `ANALYTICS_EVENTS` in `src/lib/analytics/catalogue.ts` with a Zod schema beside it. A name that is not in that list cannot reach `captureServerEvent`: the type system is the enforcement, not review. Names follow `object.verb_past` with a dot, matching `ALERT_KINDS`.

| Event | Fired from | Side | Properties beyond `locale` |
|---|---|---|---|
| `lookup.started` | `requestResearch`, after the company and run rows insert | server | `organizationId`, `companyId`, `runId` |
| `research.finished` | `research-company` task, at the terminal status write | server | `organizationId`, `runId`, `status`, `kpiCount`, `provider`, `durationMs` |
| `benchmark.computed` | `benchmark-company` task, after the snapshot insert | server | `organizationId`, `companyId`, `triggerKind`, `kpisCompared`, `modelVersion` |
| `benchmark.viewed` | `BenchmarkViewed`, a client child of the dashboard | **browser** | `organizationId`, `companyId`, `snapshotId` |
| `kpi.client_saved` | `saveClientKpis`, after the write | server | `organizationId`, `companyId`, `kpiKeysSent`, `reportingYear` |
| `kpi.client_cleared` | `clearClientKpi`, after the delete | server | `organizationId`, `companyId`, `kpiKey` |
| `checkout.started` | `startCheckout`, after the session id write is confirmed | server | `organizationId`, `orderId`, `packageKey`, `grossRappen` |
| `payment.completed` | `confirm-order` task, after `settleOrder` succeeds | server | `organizationId`, `orderId`, `packageKey`, `grossRappen`, `invoiceNumber` |
| `enquiry.sent` | `submitEnquiry`, after the row insert | server | `topic` (no organization: the sender may be anonymous) |
| `expert.profile_completed` | `updateExpertProfile`, on the save that flips the status to `active` | server | none (no organization: an expert belongs to none) |
| `expert.assigned` | `assignExpert`, after the assignment insert | server | `organizationId` |
| `scaffold.test_event` | the ops only `/admin` probe | server | `source` |

`locale` is the short code `de` or `en`, matching `docs/localization.md`, and every schema requires it, so the language breakdown is never partial. A call site holding a `Locale` maps it through `LOCALE_CODE` rather than passing the tag.

Two naming decisions worth not re-litigating: `payment.completed` fires from the `confirm-order` task rather than inside `settleOrder`, because `settleOrder` is the shared resumable core that the ops `markOrderPaid` path also runs, and firing inside it would double count one payment. `expert.profile_completed` is not `expert.onboarded`, because that exact string is already an `ALERT_KINDS` entry and one name must not mean both an alert and an event.

## Adding an event

1. A name in `ANALYTICS_EVENTS` and a schema beside it in `analyticsProperties`. The `satisfies` check fails if you add one without the other.
2. Decide whether it carries an `organizationId`. An event a signed in person fires requires one; an event that can precede an account declares none, so no call site invents a placeholder. `tests/lib/analytics/catalogue.test.ts` fails until the new name is placed in one of its two groups, which is the moment to make that decision.
3. Call `captureServerEvent` **after** the write that makes the work durable, never before. In a task this matters twice over: a retried attempt that crashed mid run must not emit a second event for one logical run.
4. A row in the table above.

Capture never blocks or breaks the caller. A bad payload, an unconfigured PostHog and a transport failure all return `false` and log; nothing throws into a server action's typed result or a task's retry. A missing event shows as a gap, while a wrong event is believed, so dropping is the right failure.

## The Release 1 funnel insight

Build it once in PostHog, in the project for the environment you are reading. Insights are per project, so staging and production each need their own.

1. **New insight → Funnel.**
2. Steps, in this order, all "Custom event":
   1. `lookup.started`
   2. `research.finished`
   3. `benchmark.computed`
   4. `checkout.started`
   5. `payment.completed`
3. **Conversion window**: 14 days. A Swiss client typically reads a report, discusses it internally and buys in a later session, so a 24 hour window reports a false cliff between step 3 and step 4.
4. **Breakdown**: `locale`. This is the point of requiring it on every schema: it separates a German pilot client's behaviour from an English one's.
5. **Step order**: sequential, not strict. `kpi.client_saved` legitimately happens between steps 3 and 4 for a client who corrects their figures, and strict ordering would drop those people from the funnel.

Save it as **Release 1 funnel**. Deliberately excluded from the funnel steps: `benchmark.viewed` (consent gated, so it would drag every later step down by the rejection rate, per the warning above) and `enquiry.sent` (a parallel path, not a step in this one).

Two events renamed with this spec, so their staging history before 2026-09-11 sits under the old names (`enquiry_sent`, `expert_onboarded`) and cannot be joined to the new ones. That is history, not state; no action.

## Monitoring

**Sentry** takes errors from the browser, the server and the tasks. Every event is tagged with a `release` pinned to the Vercel commit SHA and source maps upload at build time, so a production stack trace names real files and lines and says which deploy it came from. The browser copy of the SHA is inlined by `next.config.ts` rather than read from `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA`, because that variable only exists when a Vercel project has system environment variables enabled.

**A failed background task reaches Slack.** `tasks.onFailure` in `src/trigger/instrumentation.ts` fires a `task.failed` ops alert beside the Sentry capture, carrying the task id, the run id, the attempt count and the error, with a button to the Trigger.dev run page. It rides the alert rail in [email.md](email.md). Two properties to preserve: it fires from `onFailure`, which runs once after retries are exhausted, not `catchError`, which runs on every attempt and would be noisy; and it is best effort, so a failed alert never masks the task failure that caused it. The error is capped at 500 characters, so a stack trace never reaches Slack.

## Per environment checklist (staging, then production)

- [ ] **PostHog project**: one per environment, in the EU (Frankfurt) region. `NEXT_PUBLIC_POSTHOG_KEY` and `NEXT_PUBLIC_POSTHOG_HOST` set on Vercel **and** in Trigger.dev, because the tasks capture too and a key missing there silently drops `research.finished` and `benchmark.computed` while the web events keep arriving.
- [ ] **Sentry**: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` set at build time on Vercel for the source map upload. Confirm a deploy's release appears in Sentry and that a test error resolves to a real file and line.
- [ ] **Slack**: the environment's `OPS_ALERT_WEBHOOK_URL` (feature 7) receives `task.failed`. Prove it by driving one task to a real failure past its retries, not by reading the code.
- [ ] **Funnel insight**: built and saved per the recipe above, in this environment's project.
- [ ] **Consent**: with no answer and with a denied answer, no PostHog request and no `ph_*` cookie leaves the browser; after accepting, `benchmark.viewed` fires once on the dashboard. `e2e/analytics.spec.ts` drives this; it needs a real key, so an environment with an empty `NEXT_PUBLIC_POSTHOG_KEY` proves nothing here.
- [ ] **Server events survive rejection**: reject analytics, run a lookup, confirm `lookup.started` still arrives. This is the claim the funnel rests on, and it is invisible locally where the key is usually empty.

## Open on staging as of 11 Sep 2026

Recorded so they are not rediscovered. None is a defect in the feature; each is environment state that only a deployment can close.

- **`E2E_SEED_PASSWORD` is not a repository secret**, so the three `benchmark.viewed` tests in `e2e/analytics.spec.ts` (the AC-4 and AC-6 thread) skip rather than run, and the consent line above stays unproven in CI. Closing it is `pnpm users:seed` against staging followed by `gh secret set E2E_SEED_PASSWORD`. Expect the first green run after that to surface failures that were hiding behind the 81 skips, so run it when there is time to read the result.

### Closed on 11 Sep 2026

- ~~**`pnpm budget` has never run on `main`.**~~ Closed the same afternoon. The `deployment_status` guard matched once a deployment actually reported success, and run `34625922098` measured all twenty two marketing pages against the live `main` deployment, every one under budget (the widest margin being `/de/kontakt` and `/en/contact` at 317.0 kB against their 350 kB ceiling). The zod runtime fix (`cd41157`, spec 0009 AC-16) is therefore proven on `main`, not only locally and on a preview.
- ~~**Migrations are not reaching staging.**~~ Closed on 11 Sep 2026. The drift was benign: `20260906073908_benchmark_seed.sql` was the 6 Sep seed, and spec 0016 regenerated it under a new timestamp (`20260911074150`), which git recorded as a rename, so the remote held a version whose file no longer existed. Because the regenerated seed upserts on `(kpi_key, industry_section, size_band, period_year)`, re-applying it updates the same 22 rows in place rather than duplicating them, which is what made `supabase migration repair --status reverted 20260906073908` the honest call rather than a fudge. After the repair, run `34625832509` applied both pending migrations (`20260911074011_benchmark_honesty_columns.sql` and the regenerated seed) and `supabase migration list` shows local and remote in step. **If this shape recurs**, the diagnosis is a renamed migration rather than a lost one: check `git log --all --diff-filter=D` for the timestamp before assuming remote state is wrong.

## Data protection

Events carry ids and codes, never personal content: no email address, no contact name, no company name and no free text message is ever a property. `enquiry.sent` carries the topic code, not the message. The schemas enforce it rather than the call sites, because a `z.object` strips a property it does not declare, so a well meant addition at a call site is dropped rather than sent.

The two paths have two legal bases, and [the record of processing](legal/record-of-processing.md) says so: the nine server side events on overriding legitimate interest (SME24 recording its own work, with no device identifier and no profile), the one browser event on consent. The privacy page's PostHog entry says the same thing in both languages. A person who rejects analytics is still counted in the server side funnel and is not identifiable from it; if that ever stops being true, both documents and `PROCESSORS` change in the same pull request.
