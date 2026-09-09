# Verify: legal, privacy and cookie consent · spec 0015 · updated 2026-09-09

_Steps derived from spec 0015 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

The first run on 2026-09-09 met 14 of 16 and failed on **AC-11** and **AC-15**, both invisible to a
green suite of 1688 Vitest, 645 pgTAP and a passing build and budget. `/debug` fixed both root
causes in `8c7c406`, added the regression tests in `b86cbf3` and `e529d2c`, and this rerun proves
the two against the running stack.

## The two defects, and what they were

**AC-15 · the auth metadata scrub was a silent no op.** `anonymisePerson` passed
`user_metadata: {}` to `updateUserById`, but GoTrue MERGES metadata rather than replacing it, so
the call returned success while the person's real name stayed in `auth.users.raw_user_meta_data`.
The routine still answered `authScrubbed: true`, so the audit log asserted a scrub that never
happened and the privacy page promised it in writing. Reproduced on the live stack before the fix:
`{}` left `full_name` intact, explicit nulls cleared it. A key is removed only when it is sent as
null, so the nulls are now derived from the keys the user actually carries — a hard coded list
would rot the day a sixth key joins sign up. The email scrub and the permanent ban always worked;
only the metadata name was retained.

**AC-11 · every toast on `/cookies` was dropped.** `Toaster` is mounted in `AreaShell`, and the
data requests card lives on `/cookies`, a marketing route outside that shell. The success path
degraded quietly (the list reloads and shows "Received"), but `already_open` and the error paths
gave the user no feedback whatsoever. The region is now mounted beside the card rather than back in
the root layout, where its weight would land on all eleven static pages; `/cookies` never renders
inside `AreaShell`, so the two cannot both mount and double a toast.

## UI / manual

- [x] Sign in as a client, open `/en/cookies`, and file a copy request → the success toast reads "Request received. We will send your copy within 30 days." and the row appears as "Received" with a due date thirty days out → **AC-11**
- [x] File the same kind again without reloading → the `already_open` toast reads "You already have an open request of this kind.", the path that previously said nothing at all → **AC-11**
- [x] Confirm the toast region is present in the `/cookies` tree and absent from the other ten marketing pages → only this page carries a `Toaster`, beside the one component that toasts → **AC-11**
- [x] File a deletion as a throwaway client, then fulfil it as ops through `/en/admin/data-requests/[id]` → the move needs two saves (`new → in_progress → fulfilled`; the adjacency list has no `new → fulfilled` edge) and each reports "Request updated." → **AC-14**, **AC-15**
- [x] Read `auth.users` back with the service client after the fulfilment → `raw_user_meta_data` holds none of `full_name`, `organization_name`, `locale` or `terms_accepted_at`, the email is `deleted+<id>@invalid.sme24.ch`, and `profiles.full_name` is null → **AC-15**
- [x] Confirm the accounting rows are untouched by the same fulfilment → `orders`, `invoices` and `order_events` keep the organisation, as Art. 958f CO requires → **AC-15**
- [x] Confirm the request row survives its subject → `requested_by` is `on delete set null`, so the compliance record proving the deletion was performed outlives the profile → **AC-11**

## Value sourcing (vary the input, check the output moves)

- [x] Give the user an extra metadata key the routine was never told about (an OAuth `avatar_url`) → it is cleared too, because the nulls come from the keys present rather than from a list → **AC-15**
- [x] Give the user no metadata at all → the payload is `{}`, the one case where empty is honest → **AC-15**
- [x] Make the auth read fail → `anonymisePerson` throws, so `updateDataRequest` leaves the request open rather than recording a fulfilment that did not happen → **AC-15**

## Commands

```bash
pnpm typecheck                                    # clean
pnpm build                                        # green; /cookies still ● (SSG) in both languages
pnpm budget                                       # every page ok; /cookies 220.2 kB of 250 (was ~206)
pnpm test                                         # Vitest 1694 passed, 1 skipped (was 1688)
pnpm db:reset && pnpm test:db                     # pgTAP 645, all pass
pnpm test:e2e legal.spec.ts                       # 32 passed (was 30)
```

The pgTAP run needs `pnpm db:reset` first: the suite's seed guard refuses a database holding rows
beyond the seed, and an e2e run leaves some behind. That is the guard working, not a failure.

## Proven against the failure

Both regression tests were run against the pre fix code and fail there, which is what makes them
regression tests rather than tests that happen to pass:

- `tests/features/legal/anonymise.test.ts` → 3 of 6 fail, including both payload assertions.
- `e2e/legal.spec.ts` AC-15 → fails with `full_name survived the scrub in raw_user_meta_data — Received: "Fixture Person"`.
- `e2e/legal.spec.ts` AC-11 → fails with the toast never found once the region is removed.

## Result

**PASS.** 16 of 16 acceptance criteria met. AC-11 and AC-15 verified against the running stack in
the real app, with the toast confirmed visually on `/cookies` in the browser.

## Noted, not fixed (outside these two defects)

- `auth.identities[].identity_data` still holds the person's email after a fulfilled deletion, and
  for an OAuth sign in it also holds `full_name` and `avatar_url`. AC-15 names exactly three places
  and this is not one of them, so widening the scrub is a spec decision rather than a debug fix.
  Worth a follow up: it is the one remaining copy of the identifying data in `auth`.
