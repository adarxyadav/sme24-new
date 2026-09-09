# Review, feat/legal-privacy-cookie-consent, 2026-09-09

**Reviewed by**: Claude Sonnet 5 (author on Claude Opus 5)
**Scope**: 99 files, branch vs main (merge base `227d52824a1367f662087defaaa11c658946e382`)
**Verdict**: Approve with nits

## Summary

This implements the four legal pages, the cookie consent gate, terms versioning and re consent, and
the ops worked data request queue with anonymisation. The engineering is unusually disciplined:
single source of truth constants tie the privacy page to the purge tasks, the RLS and grant model is
airtight and pgTAP proven, the anonymisation routine is deliberately idempotent (with a real
regression test for the GoTrue metadata merge trap), and the migration hand fix gaps called out in
AGENTS.md are correctly applied where they apply.

The one substantive gap is that `updateDataRequest`'s optimistic concurrency guard protects the row
write but not the anonymisation side effect that precedes it, so a losing race on a deletion
fulfilment can still irreversibly scrub and ban a person even though the request's own status update
is rejected. A second, lower severity gap is that `terms_version` (like the pre existing
`terms_accepted_at`) is trusted from `auth.signUp` metadata with only a shape check, so a user can
self assign a terms version they never saw and permanently skip the AC-10 re consent dialog. Test
coverage is excellent everywhere except `AnalyticsProvider`, the actual analytics gate, which has no
Vitest coverage at all.

## Major

### Anonymisation runs before the concurrency guard that protects the request row, `src/features/legal/actions.ts:240-274`

**Problem**: `updateDataRequest` reads `current.status` once, then (for a deletion reaching
`fulfilled`) calls `anonymisePerson` at line 245, an irreversible action that scrubs the auth email,
empties `user_metadata`, deletes the private photo and bans the account forever, before the guarded
write `.eq("status", from)` at lines 264 to 270 executes. That guard only protects the
`data_requests` row itself: if the stored status changes between the read (lines 229 to 233) and the
write, for example a second ops user moves the same `in_progress` deletion to `refused` in the gap,
or two ops users both race `in_progress` to `fulfilled`, the loser's write matches zero rows and the
action correctly returns `invalid_transition`, but `anonymisePerson` has already run to completion
for that loser. The person is banned and scrubbed even though the persisted row may show `refused`.

**Why it matters**: This is a compliance feature whose central guarantee (AC-15) is that
anonymisation happens in one transaction inside `updateDataRequest` so the audit log proves what
happened. A race where the account is irreversibly banned and scrubbed without the row ever
recording `fulfilled`, or while it instead records `refused`, breaks that guarantee: the audit log
and the row would show a refusal or an error while the person has in fact lost their account. This is
exactly the window a two ops user workflow will eventually hit, and the runbook explicitly expects
ops to hand off to a colleague.

**Suggested fix**: Make the anonymisation conditional on having actually won the row update. Either
perform the guarded `UPDATE ... WHERE status = from` first, or re verify the row is still in `from`
inside the same operation that decides to anonymise (a select for update in a single RPC or
transaction, or a re check immediately before calling `anonymisePerson` that aborts with
`invalid_transition` if it has moved). The design note that a throw from `anonymisePerson` leaves the
request open and honest is right for genuine failures; it does not cover the case where a concurrent
status change made the anonymisation itself the wrong action to take.

## Minor

### `AnalyticsProvider`, the actual consent gate, has no unit test coverage, `src/lib/analytics/client.tsx:18-63`

**Problem**: `AnalyticsProvider` is the one function the spec says must be the sole caller of
`posthog.init` (AC-1) and the sole place withdrawal is implemented (AC-4). There is no Vitest test
for this module, and no e2e test names it directly either: `e2e/consent.spec.ts` verifies outcomes
(no network hits, cleared cookies and localStorage) but does so by reloading with a cookie already
set, not by exercising the same tab withdrawal branch (`posthog.opt_out_capturing()` and
`posthog.reset(true)` when `posthog.__loaded` is true) that the code comments describe as the point
of watching the store rather than reading the cookie once.

**Why it matters**: Branching, security relevant logic without a test is at least a Minor. The gate is
the crux of the whole feature's compliance claim, and the same tab opt out and opt in branches (lines
27 to 40 and 45 to 48) are currently exercised by nothing that would fail if `opt_in_capturing()`
were swapped for a full re `init()` and started double counting.

**Suggested fix**: A Vitest test mocking `posthog-js` to assert `init` is called only when `allowed`
is true and a key is configured, and that `opt_out_capturing`, `reset` and `opt_in_capturing` are
called on the right transitions, would close this without needing a browser.

### `terms_version` is trusted from user supplied sign up metadata with only a shape check, `supabase/schemas/01_profiles.sql:143-152`

**Problem**: `handle_new_user()` accepts any string matching `^[A-Za-z0-9._-]{1,16}$` from
`new.raw_user_meta_data ->> 'terms_version'` as the stored `terms_version`. This metadata is caller
controlled: any signed out client can call `supabase.auth.signUp` with
`options: { data: { terms_version: "999", terms_accepted_at: "<any ISO date>" } }` directly against
the public anon key, bypassing the app's sign up form entirely. The same pre existing weakness
already applies to `terms_accepted_at` under spec 0005, so this is not a new class of hole, but it
now extends to the compliance critical version comparison AC-10 depends on.

**Why it matters**: `termsAreCurrent` is a strict equality check with no upper bound, so self
assigning a version like `"999"` at sign up permanently exempts that account from every future re
consent dialog, since no real bump will ever equal `"999"`. The blocking dialog's guarantee, that a
person cannot use any signed in page until they accept the new version through the one allowed write
path, is defeated for anyone calling the Auth API directly instead of the form.

**Suggested fix**: Either constrain `handle_new_user()` to accept only a version the trigger can
check against a known list, or accept that this mirrors the pre existing `terms_accepted_at` trust
model and record it as a known limitation the way that one is. It is currently undocumented as a
tradeoff in the spec's security model or consequences sections.

## Nits

- `src/features/experts/actions.ts:223`, the docstring still says `accept_terms()` writes only while
  the stamp is null, which was true before spec 0015; the function now also writes whenever the
  version differs. Stale comment beside code that was correctly updated two lines later.
- `src/features/legal/consent-store.ts`, there is no cross tab propagation (no `storage` or
  `visibilitychange` listener): withdrawing consent in one tab does not stop an already open second
  tab from sending PostHog events until it reloads. AC-4's test scenario is same tab, so this is not a
  spec violation, but it is worth a line in the spec's consequences or a follow up given the
  compliance framing.
- `src/features/legal/ui/data-requests-card.tsx:69-71`, the `useEffect` calling `load()` on mount is
  fine under the codebase's event versus effect rule (genuine synchronization, not success work), but
  it would silently swallow an error if a throwing call were ever added inside it. It cannot throw
  today; flagged for a future reader.

## Strengths

- The anonymisation routine (`src/features/legal/anonymise.ts`) is genuinely careful: idempotent at
  every step, ordered public columns first and auth scrub last so a partial failure fails visibly
  rather than orphaning an unreachable account, and it derives the metadata null payload from the keys
  actually present rather than a hard coded list, with a dedicated regression test reproducing the
  exact GoTrue merge semantics bug a naive `{}` payload would have reintroduced.
- The retention and processor constants (`retention-periods.ts`, `processors.ts`) are wired directly
  into the purge tasks by re export, so the privacy page and the code that enforces retention cannot
  drift.
- The RLS and grant model for `data_requests` is thorough and pgTAP proven from every angle: subject
  only read, ops read, revoked UPDATE for every app role, column scoped INSERT grant, audit trigger
  coverage, tenant table contract exclusion with a documented reason. The applicable AGENTS.md
  migration hand fix gaps (REVOKE ordering, anon execute revoke, view grant widening) are present.
- The cookie bar's hidden by default, mount gated rendering and the `--consent-bar-height` CSS
  variable fix for the sidebar footer show real attention to hydration flash and layout collision bugs
  that are easy to miss and hard to detect in jsdom.

## Test coverage

Excellent overall: the legal feature's Vitest tests pass, the pgTAP RLS, grant and constraint tests
are thorough (`data_requests.test.sql`, `accept_terms.test.sql`, `record_of_processing.test.sql`),
and the e2e suite exercises the consent bar's AC-2 dark pattern checks plus a full live deletion
scrub round trip. Two gaps: no unit test for `AnalyticsProvider` itself (Minor above), and no test,
unit, pgTAP or e2e, for the concurrent fulfilment race on a deletion request. The existing race test
at `tests/features/legal/actions.test.ts:458-469` covers only a non deletion `in_progress` move, not
the anonymise then lose the write scenario in the Major finding.

## Note on this review

A first pass on this same diff ran on the author's own model (Opus) because a reviewer model override
did not take effect. It returned Approve with nits, no blockers and no majors, and missed the Major
above. This file is the Sonnet pass that replaced it, which is the cross model read `/check review`
exists to provide.

## Outcome, 2026-09-09

Worked by `/debug` on the same day the review landed.

- **Major, anonymisation before the concurrency guard**: fixed in `fbc9b81`. The guarded status
  write now runs first and is the claim, so a caller whose write matches zero rows never reaches
  `anonymisePerson`; if the scrub then throws, the claim is released back to the status the caller
  read, which keeps the other half of the promise that no row claims a deletion that did not
  happen. The audit trigger records the claim and the release both. A regression test was added and
  proven to fail without the fix (`never anonymises when it loses the race for the row`), and the
  two existing tests that encoded the old ordering were rewritten to the new contract. No sibling
  instances: the one comparable guarded write, `orderDeliveryState` in spec 0014, has no side
  effect before its guard, and `deactivateExpert`'s ban is reversible by design.
- **Minor, `AnalyticsProvider` untested**: fixed in `ea73a1e`. Eight Vitest tests over the gate's
  branches: no key, no answer, denied, granted, same tab withdrawal and same tab re acceptance.
  Both same tab branches are mutation proven, swapping `opt_in_capturing` for a second `init` or
  dropping the `opt_out_capturing` and `reset` each fail the suite, which is the exact regression
  this finding named.
- **Minor, `terms_version` trusted from sign up metadata**: recorded as a known limitation rather
  than fixed, which is the option this finding offered. Investigation found the hole is wider than
  reported: `accept_terms(version)` takes the version as an argument with the same shape only
  check, so a signed in user can self assign one without touching sign up metadata at all. Both
  doors were proven against the local stack. Closing it properly needs the database to know which
  versions are real, which is a schema decision rather than a code fix, so it is written up in the
  spec's Consequences and owned by a new follow up.

The three nits were read and left as they are, in line with the review's own framing of them.
