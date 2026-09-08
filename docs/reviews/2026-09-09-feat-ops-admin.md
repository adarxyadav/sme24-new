# Review, feat/ops-admin, 2026-09-09

**Reviewed by**: Claude Sonnet (spawned as the contrasting reviewer; the code was authored on Opus 5)
**Scope**: 49 files (48 reviewed; `work/homepage-concept/*` is unrelated design scratch, noted only as a nit), branch vs `main` (`b7b737843f7de42beb3236d77b42dc825f47417c`)
**Verdict**: Approve with nits

## Summary

Feature 12 (spec 0014) turns `orders` into the delivery record: four nullable columns, three new
statuses, two new triggers, and a full ops surface (`/admin`, `/admin/orders` scheduling, and the
new `/admin/companies` list/detail) plus the client-facing "your assessment" card and the
`assessment_scheduled` email. The database is genuinely the state-machine guard — every transition
and every correction-path edge case is proven by a 42-assertion pgTAP suite that exercises the
exact scenarios the spec calls out (concurrent scheduling, a deactivated expert, the correction
trigger firing independently of the status trigger, the revoke holding for ops's own token). The
Vitest suite over `actions.ts` matches that rigor: ordering of writes, guarded filters, and error
mapping are all asserted, not just happy paths. This is a strong, spec-faithful build. The issues
below are two real accessibility gaps in the scheduling/correction dialogs, a documented decision
to leave a fixed latent bug pattern in eight other components, and a handful of minor/nit items —
nothing here is a correctness or security blocker.

## Major

### 🟠 The Combobox's closed prop list silently drops `aria-describedby`, and the expert picker's hint reaches no assistive technology, `src/components/ui/combobox.tsx:24`

**Problem**: `ComboboxProps` (lines 24–36) has no `aria-describedby`/`describedBy` field, and the
inner trigger is a real `Button` (line 69) that *would* forward it if it were passed down — the
primitive just never receives or wires it. Two consequences follow directly in this diff:

- `schedule-dialog.tsx` (lines 112–127): the expert `Combobox` has no `FieldDescription` at all —
  unlike the date field two lines above it, which does get a properly wired hint via
  `aria-describedby={`schedule-at-hint-${orderId}`}`.
- `delivery-actions.tsx` (lines 258–274): the expert `Combobox` in the correction dialog *does* get
  a `FieldDescription` (`{t("correct.expertHint")}`, line 273) carrying real, decision-relevant
  copy — "A different assessor gets access to this client, and the previous one loses it unless
  another booking still names them" (`messages/en-CH.json:2165`) — but the `<p>` has no `id`, and
  even if it did, the `Combobox` primitive has nowhere to put an `aria-describedby` pointing at it.
  A sighted ops user reads this warning; a screen-reader user picking the same control never hears
  it, and has no way to know that reassigning the expert here has a side effect on someone else's
  access.

**Why it matters**: WCAG 2.2 AA requires programmatic association between a control and its
supporting text (1.3.1 Info and Relationships), and the missing association here withholds
consequential information (an access change to a third party) specifically from assistive
technology users. The project's own rule is "Biome a11y rules in the editor, axe in Playwright as
the second net" — this is exactly the class of gap axe cannot catch, because the visible text and
the control both render; only the *association* is missing, and Biome's static rule doesn't reach
into a component composed from `Popover`/`Command`/`Button` this way.

**Suggested fix**: This is the primitive's problem, not each call site's. Add a
`describedBy?: string` (or `"aria-describedby"?: string`) prop to `ComboboxProps` and forward it to
the trigger `Button` (line 69) the same way `aria-invalid` already is (line 75). Then wire
`schedule-dialog.tsx`'s and `delivery-actions.tsx`'s expert fields the same way the date field
already is: an `id`'d `FieldDescription` plus `describedBy` on the `Combobox`. Fixing it on the
primitive means `assignments-section.tsx` (the third `Combobox` consumer, `src/features/experts/ui/assignments-section.tsx:93`)
and any future consumer get the same capability for free, instead of each feature reaching for its
own workaround.

## Minor

### 🟡 The repeated-effect bug the hook was just fixed for is still live in the other eight `useFormAction` consumers, `src/hooks/use-form-action.ts:8`

**Problem**: Commit `c6442f2` fixed a real, observed bug in `schedule-dialog.tsx` and
`delivery-actions.tsx`: an effect keyed on `useActionState`'s `result` ran the success work (toast,
`router.refresh`, dialog close, field reset), and because `result` is held for the life of the
component, "one booking fired four toasts and four `router.refresh` calls, one correction two, and
neither dialog could be reopened." The fix moves that work into the click handler via
`submit`'s now-resolving promise, and the hook's new doc comment explains why (`use-form-action.ts:12-19`).
The commit message is explicit that "the other eight consumers are unchanged" and names the reason
("`submit` still works ignored"), which is true — the API is backward compatible. But all eight
still use the exact vulnerable pattern this commit diagnosed and fixed:
`src/features/enquiries/ui/enquiry-status-form.tsx`, `src/features/experts/ui/account-actions.tsx`
(three separate effects, one for each of resend/deactivate/reactivate), `assignments-section.tsx`
(two effects), `invite-form.tsx`, `onboarding-form.tsx`, `ops-notes-editor.tsx`, and
`profile-form.tsx` all pair a `useEffect` on `<action>.result` with `toast.success` and/or
`router.refresh()` inside a `Dialog`-bearing or list-rendering component. `photo-field.tsx` and
`marketing/ui/enquiry-form.tsx` are the two exceptions that dodge the class of bug entirely by
branching in the render body instead of an effect.

**Why it matters**: The bug's trigger condition (repeated re-render of a component whose
`useActionState` result is stale-truthy, most visibly a `Dialog` reopened for the same row) is
plausible in at least `account-actions.tsx`'s deactivate confirmation dialog and
`assignments-section.tsx`'s per-row "End" button list, which are structurally the closest analogues
to the two components that already exhibited it. Whether it reproduces today depends on rendering
details (Suspense/transition behavior around `router.refresh()`) that are exactly what made the
original bug non-obvious until it was observed in practice, not something safe to reason away by
inspection. Today this is a known, accepted risk with a clear paper trail (the commit says so
outright); it becomes a real finding if a QA pass or a user report turns up a duplicated toast or a
dialog that won't reopen anywhere in those eight components, since the fix pattern is already
proven and just needs porting.

**Suggested fix**: No action needed for this PR specifically — the scope discipline (fix the
reported bug, don't refactor eight unrelated components) is defensible for a Tracer Bullet feature
branch. Flagging it here so it becomes a tracked follow-up rather than a rediscovered surprise:
either fold "port the click-handler pattern to the other eight `useFormAction` consumers" into a
follow-up scope item, or add a short-lived code comment/TODO next to `useFormAction` pointing at
this list so the next person touching any of the eight ports the fix opportunistically.

### 🟡 `useFormAction` has no dedicated unit test, `src/hooks/use-form-action.ts:20`

**Problem**: The hook itself — the `settle` ref hand-off, the promise resolving exactly once per
`submit`, and the documented "one submit in flight at a time" assumption (line 22-24) — is only
exercised indirectly through `schedule-dialog.test.tsx` and `delivery-actions.test.tsx`. `TESTS =
configured` in this project, and a shared, non-trivial piece of infrastructure used by ten
components (two in this PR, eight pre-existing) changing its resolution semantics is exactly the
kind of change the guide calls out as warranting direct coverage, not only coverage-by-consumer.

**Why it matters**: The one edge case the hook's own comment defends against by assumption rather
than by guard — a second `submit()` call arriving before the first one's dispatch has resolved,
which would silently resolve the *first* caller's promise with the *second* call's result and leave
the first caller's promise unsettled forever — has no test proving the documented mitigation
("every caller disables its button while pending") actually holds, nor a test of what happens if it
doesn't.

**Suggested fix**: A small `tests/hooks/use-form-action.test.tsx` (or similar) driving the hook
directly with `renderHook` would pin the one-resolution-per-submit contract and document the
double-submit behavior as either accepted or guarded. Not blocking, since the two real consumers in
this diff are covered end-to-end and disable their buttons correctly.

### 🟡 No index on `orders.scheduled_by`, `supabase/schemas/41_orders.sql:100`

**Problem**: `assigned_expert_id` gets `orders_assigned_expert_id_idx` (line 112) because "the
dashboard and the correction path both look an order up by its assessor," but `scheduled_by` has no
index despite carrying the same shape (nullable FK to `profiles`).

**Why it matters**: Nothing in this spec queries by `scheduled_by` today, so this is speculative —
but an ops "who scheduled this" audit view (plausible given the FADP audit-trail emphasis
elsewhere in the spec) would table-scan. Low priority since it's currently unused.

**Suggested fix**: Add `create index orders_scheduled_by_idx on public.orders (scheduled_by);` only
when a query actually needs it — flagging so it isn't forgotten if/when that query shows up.

## Nits

- ⚪ `work/homepage-concept/*` (four files: `direction.md`, `geist.woff2`, `mark.svg`, `philipp.webp`)
  is unrelated marketing/design scratch material riding along on this branch, unrelated to spec
  0014. It also carries the one pre-existing lint error (`noSvgWithoutTitle` on `mark.svg`). Worth
  splitting onto its own branch/commit before merge so the ops-admin history stays about ops admin.
- ⚪ `src/app/[locale]/admin/orders/page.tsx:113,116`, two `as never` casts
  (`t(`method.${order.payment_method}` as never)`, `orders(`status.${order.status}` as never)`) are
  pre-existing patterns from spec 0011, not introduced here, but the new `order.status` union grew
  by three values without a corresponding widening of whatever the "as never" is working around —
  worth a look next time next-intl's typed-messages story is revisited.
- ⚪ `src/features/ops-admin/ui/scheduled-assessments.tsx:65`, `orders(`status.${assessment.status as "scheduled"}`)`
  narrows a three-way union (`scheduled | in_progress | delivered`) down to one literal purely to
  satisfy the translator's typed key lookup; harmless since all three keys exist and are exercised
  by tests, but the cast reads as if only `scheduled` were possible.
- ⚪ `docs/scope/commerce.md`, "Test it" and "Review it" and "Document it" are still unticked for
  feature 12 even though this review is running now — expected mid-flow state for a GA-tier feature
  branch, not a defect, but worth remembering to tick after this review lands.

## Strengths

- The state machine is genuinely database-enforced, not app-enforced: `private.check_order_transition()`
  and the new `private.check_order_delivery_columns()` cover every edge the spec lists (AC-3 through
  AC-7a) plus the subtle interaction between the two triggers (the unschedule edge writing both
  columns in the same statement as the status, and the correction trigger correctly *not* re-firing
  the future-date check), and the pgTAP suite (`supabase/tests/order_delivery.test.sql`, 42
  assertions) proves it against a real database rather than mocking it — including the exact
  concurrency and correction-path scenarios the spec's "Critical test scenarios" section calls out
  by name.
- `scheduleOrder`/`rescheduleOrder` writing the `expert_assignments` row *before* the order,
  documented and tested as deliberate (so a deactivated expert is refused before the order moves),
  is a genuinely careful ordering decision that a less careful implementation would get backwards.
- Every write path is guarded on the exact status the read saw (`.eq("status", "paid")`,
  `.in("status", [...LIVE_DELIVERY_STATES])`), so a lost race surfaces as `invalid_transition`
  rather than a silent overwrite — proven in both the pgTAP suite and the Vitest action tests
  ("tells the loser of a race invalid_transition").
- `docs/specs/0014.../index.md`'s migration-plan risk note calls out a *fourth* declarative-diff
  gotcha beyond the three `AGENTS.md` already names (the diff would have widened
  `assigned_expert_summaries`' grant to full DML for `authenticated`) and the migration file shows
  it was actually caught and hand-trimmed, with the reasoning left in a comment. That is exactly the
  kind of vigilance the project's own rules ask for around `pnpm db:diff`.
- The e2e spec (`e2e/ops-admin.spec.ts`) is honest about what pgTAP and Vitest cannot prove (a real
  action invoked from a real signed-in session, closing the AC-8 gap those two nets structurally
  miss) and explains *why* it must run serial (a single shared `expert_assignments` row between
  workers) rather than leaving that as a silent flake risk.
- The `zurichInstant`/`formatZurichWallClock` round-trip handling of the DST transition (refusing
  the skipped spring-forward hour rather than silently rolling it into the next real hour) is
  correct and is pinned by tests for both directions and both Swiss offsets.

## Test coverage

Strong. The pgTAP suite covers every transition edge, both guard triggers, the correction path
independently from the status path, the audit log, and the revoke against all four roles including
ops's own token. The Vitest action tests cover authorization for every non-ops caller, write
ordering, guarded-filter races, every error code the action can produce, and the email-skip-on-
missing-name path. The schema tests pin the DST edge cases explicitly. The UI tests
(`schedule-dialog.test.tsx`, `delivery-actions.test.tsx`) include a regression test for the exact
bug the click-handler refactor fixed (dialog reopens cleared, not slammed shut). The one gap is
`useFormAction` itself having no direct unit test (Minor, above) — everything else in this diff is
well covered, including through the one avenue (`e2e/ops-admin.spec.ts`) that reaches what neither
pgTAP nor Vitest can.
