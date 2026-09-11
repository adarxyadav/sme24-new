# Verify: peer data curation & model honesty · spec 0016 · updated 2026-09-11
_Steps derived from spec 0016 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones._

The local stack must be running (`supabase start`). Steps marked **worker** need `pnpm trigger:dev` in fixture mode with `TRIGGER_DEV_RUNNING=1`.

## Commands

- [x] `pnpm test:db` → `benchmarks.test.sql` and `benchmark_assumptions.test.sql` both ok → AC-1, AC-2, AC-3
- [x] `pnpm vitest run tests/features/benchmark` → all pass, including the shape rule and the two average positions → AC-4, AC-5, AC-13b
- [x] `pnpm vitest run tests/features/marketing/benchmark-example.test.ts` → the model over the committed CSVs reproduces the landing page figure → AC-14
- [x] `pnpm vitest run tests/features/research/catalogue.test.ts` → every KPI carries a peer status and a note key in both catalogs → AC-7
- [x] `pnpm vitest run tests/email/benchmark-ready.test.ts` → the range leads, and half a range falls back to the single figure → AC-13
- [x] `pnpm build && pnpm budget` → build green, every page inside its first load budget → AC-9, AC-16
- [x] Gate query one: `select 'benchmarks' as t, count(*) from public.benchmarks where provisional union all select 'benchmark_assumptions', count(*) from public.benchmark_assumptions where provisional;` → 22 and 4 before curation, zero and zero at the launch gate → AC-3
- [x] Gate query two: `select 'benchmarks' as t, kpi_key as key from public.benchmarks where is_assumption union all select 'benchmark_assumptions', key from public.benchmark_assumptions where is_assumption order by 1, 2;` → exactly the three `indirect_multiplier*` rows on `benchmark_assumptions`, no peer row → AC-3
- [x] `pnpm vitest run` → the whole suite green, so no consumer of `POSITIONS`, `MODEL_VERSION` or the snapshot types was left stale → AC-12

## UI / manual

- [x] Sign in as a client whose company is NOGA section C (a distribution row) with a snapshot → the positions list draws the quartile band and shows a quartile position, exactly as before → AC-6
- [x] **worker** Sign in as a client whose company is NOGA section 35 (section D, a point row) → the accident rate row draws no `QuartileBand` and no replacement graphic, shows one labelled sector figure of 44.3, carries the "one figure for the whole sector" line, and its text contains none of quarter, quartile, median, p25, p75 → AC-6, AC-15
- [x] Same point row with a screen reader (or read the `.sr-only` text) → the narration names one sector figure and never three identical quartiles → AC-6
- [ ] A company whose own section has no peer row (for example NOGA 62, section J) → the peer label says the group was broadened rather than naming the company's own sector → AC-6b
- [ ] The ISO 45001 row on any company → the band label is "Better/Worse than the sector average", never a median wording → AC-5
- [x] The opportunity card → the range leads at headline size with the working estimate beneath it, and the shown low is at or below, the high at or above, the computed `cost_low_chf`/`cost_high_chf` on the snapshot row → AC-9
- [x] Open "How this is calculated" → each of the three multipliers carries a "declared assumption" badge and its own note naming its source (ILO low, Heinrich 1931 high, SME24's own estimate in the middle), and states no Swiss ratio is published → AC-10
- [x] The `fatalities` and `near_miss_rate` rows → each shows "No Swiss peer data exists" with its own sentence, not the shared "No peer data yet"; both still appear in the list → AC-8
- [x] A `pending` KPI (for example `absenteeism_rate`) → a "not yet" wording that names what is awaited → AC-8
- [x] `/admin/design` as ops, both themes and both locales → the point comparison example and the range led card render, axe reports no violations → AC-16
- [ ] **worker** The `benchmark_ready` email in Mailpit, both languages → the range line comes before the working estimate, and its ends match the card's for the same snapshot → AC-13
- [x] `docs/benchmark.md` → names both gate queries, the two flag meanings, the shape rule, the two source columns, the per KPI status and the five confirmed dead ends → AC-17

## Value sourcing (one step per row of the spec's table)

Each of these exercises where a displayed value comes from, so a mis sourced value shows up even if the gate missed it.

- [ ] Edit one seeded peer row so `p25 == median == p75`, regenerate with `pnpm benchmarks:migration`, `pnpm db:reset`, recompute → that KPI flips to a point row with no band; revert afterwards. Shape is derived from the values, never a column → AC-4
- [ ] Set `source_key` on one peer row (for example `Suva class 22A`), recompute → the positions list names that classification instead of the NOGA section; null restores the section, band and year label → AC-6
- [ ] Set `basis_de`/`basis_en` on one peer row, recompute → the disclosure shows that sentence; with both null, no caveat line and no empty element renders → AC-11
- [ ] Change `is_assumption` on one assumption row, recompute → the badge and its note appear or disappear in the disclosure; `note` alone without the flag renders nothing → AC-10
- [ ] Change a company's headcount so the cost crosses CHF 10 000 → each range end rounds at its own step (nearest 100 below 10 000, nearest 1 000 above), and the band still contains the point estimate → AC-9
- [x] Switch the locale between `de` and `en` on a point row and on the disclosure → every new string resolves in both catalogs, with no raw message key visible → AC-6, AC-8, AC-10, AC-13b
- [x] Read a stored `@1` or `@2` snapshot row (one written before this deploy) → it still parses and renders; the shape falls back to the derived rule and no assumption badge appears, rather than the page breaking → AC-12
- [ ] After deploying, run `pnpm benchmarks:recompute` and watch it → every snapshot moves to `benchmark-model@3`, which also clears the outstanding `@2` debt from spec 0012 → AC-12

## Acceptance-criteria coverage

- AC-1 pgTAP + `pnpm test:db` · AC-2 pgTAP flags + seed suite · AC-3 both gate queries + pgTAP
- AC-4 model suite + the seed edit step · AC-5 model suite + the ISO row step · AC-6 the point and distribution UI steps + `source_key` step
- AC-6b the broadened group step · AC-7 catalogue test · AC-8 the sourceless and pending row steps
- AC-9 the card step + the 10 000 boundary step · AC-10 the disclosure step + the `is_assumption` step · AC-11 the `basis` step
- AC-12 the stored `@1`/`@2` step + the recompute step · AC-13 the email test + the Mailpit step · AC-13b catalogue completeness test + the locale step
- AC-14 the marketing example test · AC-15 the point row Playwright thread with axe · AC-16 the gallery step · AC-17 the runbook step
