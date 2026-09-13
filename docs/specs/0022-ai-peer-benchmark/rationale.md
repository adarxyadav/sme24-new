# 0022. Peer benchmark from the research run: the reasoning

The decision record for [index.md](index.md). `/develop` skips this file.

## Context

> ⚠️ Premise note: the design removes the one human check the old benchmark had (a person read every peer page before a client saw the figure) and shows a money figure whose basis (75 per working hour, 769 hours per lost time injury) is never on the page. Both are owner decisions of 14 Sep 2026, taken knowingly: the curated path never reached a client (the recompute that would have shown named peers was never run on any environment), and the client's stated need is the size of the loss, not the provenance of the peer's rate. The failure mode to watch is a wrong unit on one peer page showing a five times error under a source link; the validator's unit conversion, the confidence and the link are the guards, and the hosted spike in the runbook is the first proof. A second concern: the topic touches three areas (research, benchmark, experts). It stays one spec because every part hangs off one run and one snapshot, and splitting it would put the page order, the only thing the client sees, across three files.

SME24 was scoped Switzerland first on 13 Sep 2026. On 14 Sep the owner reversed that: the product is global from the start, and the client wants the money above all. Both cut through the benchmark as built. Its peers were 122 sector rows read from three Swiss publications and fourteen European companies read by hand, its cost model rested on seven Swiss constants of which four were never verified, and its incident count preferred the one KPI no other country publishes. A German client would have landed on "no national figure yet", an American one on nothing at all. Spec 0020 planned to fix that one country at a time, each with a reading session; that path does not reach the world.

The research pipeline already does the hard part: a run turns a company name into cited figures through a web research provider and a validating model call. The same machinery can find the peers, and the owner's own loss table (page 3 of the ISO 45004 KPI document in `docs/raw/`) prices an incident in hours that are the same in every country, so only the cost of a working hour is local. The five hour budget rules out anything that is not an extension of what runs today.

## Options considered

### Option 1: Fix in place, add the run's peers as one more rung

Keep the curated library and the sector rows and let the research run add a fifth source of peers when the library is thin.

**Pros**:
- The verified pair and the human read stay for the companies that have them.
- No table is dropped; no migration risk.

**Cons**:
- Two code paths with two honesty rules in one card; a client cannot tell a read row from a found one without a badge the owner has already cut.
- The Swiss constants and the Suva KPI stay under the money; the global problem is not solved, only padded.
- More code than either replacement, inside five hours.

### Option 2: Strangler, both behind a flag

Build the run based benchmark beside the old one, switch companies over by a flag, retire the old path once the live provider proves itself.

**Pros**:
- Instant rollback per company; the hosted spike can run on real clients before the switch.

**Cons**:
- Two models, two snapshot shapes and two pages maintained at once, for a path that never reached a client and has nothing to keep running.
- The flag and the double render cost most of the budget; the old page still shows Swiss figures to non Swiss clients in the meantime.

### Option 3: Replace directly, one migration, one deploy

The run finds the peers, the model prices with the loss table, the four tables and their seeds go in the same migration, old snapshots render as outdated with a rerun prompt.

**Pros**:
- One input path, one model, one page; the smallest code and the only one that fits the budget.
- Nothing a client saw is lost: no client ever received a named peer or a non Swiss figure from the old path.

**Cons**:
- No gradual proof on live data before every client sees it; the hosted spike happens after the merge.
- The "add, switch, remove later" migration rule is set aside for four tables, and the unmerged chart branch's preview breaks.

## Rationale

The owner's answers settle it: no stored peer data, no fallback, every client gets a result, five hours. Option 1 keeps the Swiss core the owner rejected. Option 2 is the textbook answer for a live system, but the strangler pattern protects traffic that exists, and the named peers had none: the recompute after spec 0021 was never run, so every client today sees Swiss sector quartiles at best. Option 3 replaces a path with no users and reuses everything that has users (the run, the validator, the snapshot, the segment). The one real risk, peer search quality on the live provider, is the same under all three options and is answered by the spike, not by the architecture.

The loss table beats the old cost formula on honesty as well as on reach. The old formula multiplied an insured cost and an absence day cost, both Swiss and both unverified, by an indirect multiplier drawn from three different decades. The owner's table names each hour a company loses (the injured employee, the investigation, the review, lost output, rework, delayed orders, the productivity dip) and sums them; the only local number is the price of an hour. Hiding that price from the page is the owner's call; the runbook carries it.

## Settled recommendations

The calls the conversation left to the architect, each with the pick, the reason and the runner up:

- **Peer search processor**: the same Parallel processor as the client run today (`summary.processor`), so cost and latency stay predictable; runner up a cheaper tier for peers, revisited after the spike.
- **Rung in code, not from the provider**: the task derives the rung from the kept peers' countries (AC-6). The provider is asked to prefer near companies but its own scope label is never trusted; runner up a `search_scope` field per peer.
- **The peer search is its own task**: `research-peers`, triggered after the client run's terminal write, with its own budget, retries and failure hook. The first draft polled both provider runs inside one 20 minute budget from one `started_at`; the cross check showed that a peer timeout would then abort the whole task through the existing budget abort and fail the client's figures, the opposite of the invariant, and that 20 minutes already exceeds the task's 900 second `maxDuration`. A task boundary makes "peers never decide the status" structural. Runner up the shared loop with a caught peer block, which keeps the coupling and the clock problem.
- **Units in code, support by the model**: the provider fills a unit enum, so times five is deterministic and never depends on the validation call; the model only confirms support and year. The first draft let the validator convert and, on its failure, kept peers at confidence 0.5, which would have shipped a per 200 000 hours figure as per million, the exact five times error the premise note names.
- **Self, parent and subsidiary exclusion**: a peer whose normalised name contains the client's or the reverse, or whose website host equals the client's, is dropped; a client benchmarked against its own group's figure is the likeliest embarrassing result. Runner up asking the provider to exclude it, which is unreliable.
- **Rate conversion**: per 200 000 hours and per 100 workers both times five (100 workers times 2 000 hours is the OSHA base); a printed unit outside the three is unsupported.
- **Recordables**: `max(0, trifr − ltifr)` with a `trifrMissing` flag when TRIFR is absent, so a client with only an LTIFR still gets a loss; runner up refusing the loss without both rates.
- **Hours per lost time injury**: 769, the mean of the table's three lost time rows (1 174, 743, 389.5); recordable 201, first aid not priced because no KPI counts first aid cases; fatality flat 1 200 000 in the client currency by the owner's answer. Runner up a weighted mix by injury type, which needs data no company publishes.
- **Retainer threshold**: 250 000 in the snapshot currency, the owner's pick; a per currency threshold is a follow up with the per country hourly cost.
- **Old snapshots**: `outdated` and a rerun prompt, by the owner's answer; the old schemas are deleted rather than kept for parsing, since nothing renders them.
- **Region for the rest of the world**: four continent groups, enough for a ladder rung; finer regions (for example ASEAN, Gulf) when a client there asks.
- **Expert request**: cut from this pass by the owner on the cross check's estimate; the cards show without a button, the action and its table are a follow up.
- **Expert exposure**: a security definer function returning seven fields, rather than a view or a policy widening, so the surface a client can read is one row type checked by pgTAP; runner up a `expert_cards` view with a policy, which is one grant away from exposing the whole row.
- **Drop the four tables now**: the migration rule exists for previews sharing staging; the only preview that reads them is the retired chart branch. Runner up keeping the tables one release, which leaves dead seed code in the tree for the whole five hours.
- **Fixture peers**: five in the country, two in the region, one elsewhere, so the fixture proves the country rung and the region fallback is a unit test on the pure rung function.
- **`kpi_definitions` row for the Suva rate**: kept, catalogue test loosened to a subset, because `company_kpis` rows reference it and a delete would cascade into client data.

## Evidence: the owner's loss table

Transcribed from page 3 of `EHS Management System_KPIs_ISO45004.docx` (version 001, the PDF export of 20 May 2026), "Calculation of losses in organisational context". Hours per incident, by category; the last column divides to about 75 CHF per working hour in every row.

| Injury | Category | Employee hours lost | Investigation, EHS manager | Review, area manager | Reduced output | Rework, scrap | Delayed orders | Productivity drop | Total hours | Cost |
|---|---|---|---|---|---|---|---|---|---|---|
| Fatality | Death | | | | | | | | | 1 200 kCHF |
| Amputation | LTI | 864 | 24 | 4 | 34 | 32 | 0 | 216 | 1 174 | 88 kCHF |
| Broken bone | LTI | 480 | 24 | 4 | 24 | 22 | 0 | 189 | 743 | 56 kCHF |
| Burn | HCI | 165 | 24 | 4 | 17 | 18.5 | 0 | 161 | 389.5 | 29 kCHF |
| Bruises, scratches | RCI | 98 | 24 | 4 | 14 | 6 | 0 | 55 | 201 | 15 kCHF |
| Cuts | First aid | 2 | 24 | 4 | 8 | 0 | 0 | 4 | 42 | 3 kCHF |

The spec's constants: lost time injury 769 hours (the mean of 1 174, 743 and 389.5), recordable 201, first aid 42 (unused), fatality 1 200 000, hourly cost 75, hours per FTE 1 800.

## Cross check of 2026-09-14

A second model read the draft and returned 18 gaps and eight soundness findings; all were applied. The load bearing ones: the shared provider budget (now a separate task), the expert photo bucket that no client could read (a storage policy for active experts), the region ladder inside SQL (the caller passes the region's codes), three `not null` snapshot columns and the CHE `uid` check that would have failed the first `@7` insert and the first foreign register number (dropped in the migration), the `outdated` state that the parsed reader could never reach (the raw version travels with the blocks), the rank sentence that could read "9 of 8" (the client counts in `of`), the year of the loss inputs (the current view's newest year per key, recorded), and the validator fallback that would have shipped unconverted rates (conversion in code). The reviewer put the full scope at eight to ten hours against the owner's five; the owner cut the currency control and the request button and kept the per peer loss column, which the reviewer would have cut first as the likeliest source of "your numbers don't add up" mail. The estimate in the build plan is the reviewer's after the cuts.

## Amendment of 2026-09-14, later the same day: the peer's own total

The owner reviewed a sketch (TRIFR up, rank across, bubble area as each company's estimated loss) and chose to show each peer's own total loss, priced with the peer's headcount, the same constants and the client's currency, rather than the client's loss at the peer's rates that the first draft used. The architect's objection is recorded, not withdrawn: the total is rate times headcount, headcounts across a peer set differ about twenty times and rates about four, so the column orders companies mostly by size (BASF at about 33 million against Rieter at about 2 million, with BASF the safer company), and any chart with money as area or height agrees with the rate axis and adds nothing. The honest comparable form is the same figure per 100 employees, which is the rate in money and puts a 500 person client and a 100 000 person peer on one scale. The owner keeps the total for now because it is the number a reader recognises, and wants the per 100 form only once Phillip or a client has approved it; the caption line under the table says the total grows with size. AC-13, AC-20, the invariants, the value sourcing, the test scenarios and the Follow-up were changed to match.

## Amendment of 2026-09-14, the merged table

The preview showed two tables, one per rate, with identical rows and one differing column, a shape inherited from the curated library where a company might publish one rate only. With peers from one run every company carries both rates, so the section is one table with LTIFR and TRIFR columns, sorted by LTIFR, and the two ranks in one sentence. A rank is a count of companies strictly better on one column and needs no table of its own; the one thing a single order cannot do is place the client at both rank positions at once, and the sentence carries the second rank. Owner decision of 14 Sep 2026.
