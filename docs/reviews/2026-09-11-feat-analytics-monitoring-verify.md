# /check verify: Analytics & monitoring · spec 0017

**Date**: 2026-09-11
**Branch**: `feat/analytics-monitoring` (HEAD `e093852`)
**Verdict**: **BLOCKED** (7 of 12 acceptance criteria met with cited evidence, 5 could not be exercised locally)

Nothing failed. Five criteria could not be driven on this machine because the environment lacks the
three secrets they depend on, and one blocked criterion hides a real gap worth naming before merge.

## How this was run

Local stack (`supabase status`: up, Zurich local Postgres on 54322), the app through `pnpm dev` on
port 3000 and through Playwright's own server on 3100, plus `pnpm typecheck`, `pnpm test`,
`pnpm build`, `pnpm budget` and `npx playwright test e2e/analytics.spec.ts`.

The environment this ran in, which decides most of the blocks:

| Variable | State | What it blocks |
|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | **empty** | every claim about an event actually reaching PostHog |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | **empty** | the Sentry half of AC-10 |
| `OPS_ALERT_WEBHOOK_URL` | **absent from every env file** | the Slack half of AC-9 |
| `VERCEL_GIT_COMMIT_SHA` | unset (not a Vercel build) | the release tag of AC-10 |

## Per criterion

| AC | Verdict | Evidence |
|---|---|---|
| AC-1 | ✅ met | `ANALYTICS_EVENTS` in `src/lib/analytics/catalogue.ts` is a twelve name `as const` union; `captureServerEvent` is generic over it. `pnpm typecheck` passes, so a free string is rejected at the type level. |
| AC-2 | ✅ met | `analyticsProperties` carries one Zod schema per name under `as const satisfies Record<AnalyticsEvent, z.ZodType>`; `captureServerEvent` `safeParse`s before sending and logs plus returns `false` on failure (`server.ts:39-48`). |
| AC-3 | ✅ met | Read every schema: the nine signed in events require `organizationId`; `enquiry.sent`, `expert.profile_completed` and `scaffold.test_event` declare none. Every schema requires `locale` via `localeCode`. |
| AC-4 | ✅ met | Playwright, two tests green: no `ph_*` key or cookie and no PostHog request before an answer, and none after a denied answer. |
| AC-5 | ✅ met | All nine names found at their specced call sites (see the call site table below). |
| AC-6 | ⚠️ **blocked (half met)** | The two negative halves pass in Playwright. The positive half (`fires once after accepting`) **skipped itself**: with no key the gate never calls `posthog.init`, so the assertion would pass on absence. Needs a real key. |
| AC-7 | ✅ met | `enquiry_sent` → `enquiry.sent` at `marketing/actions.ts:134`; `expert_onboarded` → `expert.profile_completed` at `experts/actions.ts:283`. No `ENQUIRY_SENT_EVENT` constant survives (`grep` finds none). |
| AC-8 | ✅ met | Every call site is `await`ed after its durable write, and `captureServerEvent` never throws: parse failure, unconfigured key and transport failure all return `false`. `pnpm test`: 2049 passed, 1 skipped. |
| AC-9 | ⚠️ **blocked** | The hook exists and is correct on inspection (`instrumentation.ts`, `onFailure` not `catchError`, dynamic import, all failures swallowed, error capped at 500 chars). **Not driven**: no `OPS_ALERT_WEBHOOK_URL` in any env file, so `opsAlertTask` returns `{posted:false}` before it would ever post. |
| AC-10 | ⚠️ **blocked** | `next.config.ts` inlines `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` and pins `withSentryConfig`'s release to the same value. Locally `VERCEL_GIT_COMMIT_SHA` is unset, so it inlines `""` and no built chunk names it. Deployment only. |
| AC-11 | ✅ met | `docs/analytics.md` exists with the taxonomy table, the funnel recipe (five ordered steps, 14 day window, `locale` breakdown, sequential-not-strict) and the per environment checklist. |
| AC-12 | ✅ met | `tests/lib/analytics/catalogue.test.ts` and `tests/lib/analytics/server.test.ts` both green inside the 2049. |

### The nine server events, all present

| Event | Call site |
|---|---|
| `lookup.started` | `src/features/research/actions.ts:119` |
| `research.finished` | `src/trigger/research-company.ts:342` |
| `benchmark.computed` | `src/trigger/benchmark-company.ts:260` |
| `kpi.client_saved` | `src/features/self-assessment/actions.ts:191` |
| `kpi.client_cleared` | `src/features/self-assessment/actions.ts:248` |
| `checkout.started` | `src/features/checkout/actions.ts:304` |
| `payment.completed` | `src/trigger/confirm-order.ts:163` |
| `enquiry.sent` | `src/features/marketing/actions.ts:134` |
| `expert.profile_completed` | `src/features/experts/actions.ts:283` |

Plus two catalogued deliberately and named in the spec: `expert.assigned`
(`experts/actions.ts:394`) and `scaffold.test_event` (`scaffold/actions.ts:68`).

## The consent basis wording, checked as rendered

The prompt asked for this specifically, and it holds. Fetched from the running app, both languages:

- `/en/privacy` → "We record our own work on your account (a lookup started, a report finished)
  **whether or not you accept**, using ids rather than your name, email or any text you wrote. Only
  the part that needs a cookie in your browser waits for your acceptance."
- `/de/datenschutz` → "Wir halten unsere eigenen Vorgänge zu Ihrem Konto fest ... **unabhängig von
  Ihrer Zustimmung** und anhand von Kennungen ... Nur der Teil, der ein Cookie in Ihrem Browser
  benötigt, wartet auf Ihre Zustimmung."
- `docs/legal/record-of-processing.md:73` states both paths and both bases (`interest` for the nine
  server events, `consent` for `benchmark.viewed`).

The old "loads only after you accept" claim is gone from all three surfaces. The cookies table's
PostHog row still says "Set only after you accept" in both catalogs, and that is **correct**, not
drift: that row describes the `ph_*` cookie, which genuinely is consent only.

Note `/privacy` 307s to `/datenschutz` under `de` (the `PATHNAMES` slug). Fetching `/de/privacy`
without following redirects returns a 15 byte body, which is the redirect, not a broken page.

## Owed before this feature is done

1. **AC-6 positive, AC-9, AC-10 need a real environment.** All three are staging checks, and
   `docs/analytics.md` already lists them in its per environment checklist. Nothing local can prove
   them, and the e2e spec is honest enough to skip rather than pass on absence.
2. **`OPS_ALERT_WEBHOOK_URL` is in `.env.example` but in neither `.env.local` nor `.env.local.bak`.**
   Any local task failure today raises an alert that is logged as skipped and reaches nobody.
3. ~~**The claim the funnel rests on is still unproven anywhere.**~~ **Closed by `/test` on
   2026-09-11.** `tests/lib/analytics/consent-independence.test.ts` pins it: all nine AC-5 events
   capture on a session carrying a real `denied` consent cookie, with a payload identical to the
   granted and absent cases, plus a structural guard that fails if `server.ts` or `catalogue.ts`
   ever imports the consent module, `CONSENT_COOKIE` or `next/headers`. The guard was mutation
   checked (adding the import makes it fail), so it is not an assertion that can never fire.
   Transmission on a real key remains a staging check, as it was.

## Not a regression, recorded so it is not re-investigated

`pnpm build` exits 0. `pnpm budget` exits 1 locally, reporting **all twenty** marketing pages
~39 to 71 kB over the 250 kB budget, every one naming the same cause and the same chunk
(`the zod runtime is in a module script (/_next/static/chunks/35bnttn_mo1lb.js)`).

This is not feature 15. The uniformity across all twenty pages, including ones this branch never
touched (`/de/preise`, `/en/expert-network/directory`), rules out a change that touched only
`next.config.ts`, `src/features/marketing/actions.ts`, `src/instrumentation-client.ts` and ~250
bytes of copy in each catalog. CI's own budget step (`pnpm budget --url`, in `e2e.yml`) ran green
on `main` this morning against a real deployment (run `34594536041`, success, 11:32 UTC). The gate
is measured against a deployment, not a local `.next`, and the scope already carries "zod locales
out of the form pages" as a known deferral. Treat the local red as a local build artifact.

An attempt to measure `main` in a throwaway worktree produced no usable baseline: both commands
died in `pnpm install` (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`) because of a symlinked
`node_modules`, so that run proves nothing and its numbers were discarded.

## For /check review

- `captureServerEvent` builds a new `PostHog` client per call and `shutdown()`s it. Deliberate and
  documented (a frozen Vercel function loses a buffered client), but it is one HTTP handshake per
  event on a hot path.
- `BenchmarkViewed`'s `useRef` guard makes it once per mount, but the effect lists all four ids as
  dependencies; the ref is what actually prevents a refire, which is fine but reads oddly.
- `benchmark.viewed` is fired from the client dashboard only, not the expert read only view. That is
  the stated intent of milestone 3, worth confirming it stays intended.
- The two negative Playwright tests use a fixed `waitForTimeout(1_000)` to assert silence. Sound for
  a negative assertion, but it is wall clock time in the suite.
