# 0021. Named published peers: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file holds the why, the options, the evidence and the references.

## Context

The benchmark's peers are the sector statistics Suva, the BFS and Eurostat publish: a spread of values by industry and size band, sourced and honest but nameless. They also leave holes in exactly the rows a client asks about first. No Swiss or European body publishes an LTIFR or TRIFR by sector, because the national statistics count accidents per full time job or per employed person and not per million hours, so those two rows have said "No national figure yet" since spec 0016 confirmed the dead end (basis: `docs/benchmark.md`, the readable and unreadable tables).

The companies that do publish those rates are the larger ones. The GRI 403 standard has asked for injury rates per million hours for years, and the EU's sustainability reporting standard ESRS S1 asks the largest European companies for a recordable accident rate on the same basis, so thousands of reports now print a comparable figure with its basis (employees only or including contractors) and its year. A 300 person manufacturer does not publish; a listed manufacturing group does. Putting the two side by side is only honest when the card says who the peers are, where they are, how big they are and what they counted.

The owner's market decision of 13 Sep 2026 (Europe, Switzerland first) and the Peer Standing design page (artifact `3ef5da7c-9080-44f9-8405-b49b75a2cbc5`) set the shape: three rings of peers, of which the sector band exists, the published peers are this feature, and the SME24 cohort waits for a client base. The page left four calls to the owner and the design conversation of 13 Sep 2026 settled them (all four on the recommended pick): larger listed peers are acceptable when labelled; the ladder climbs to the world by default and names its rung; the client's saving is priced at every peer it is behind; the chart goes to the client page, and after the cross check the owner made it the slice after this one. The forces on the design are the ones spec 0008 and 0016 set: one pure calculation, one immutable and versioned snapshot, values with a named source or no value, a point row that never says median, a launch gate that blocks what nobody has read.

**Compliance scope**: none new. The library describes companies from public reports; the one person's name in it is the curator's own.

## Options considered

### Option 1: Hand written peer rows in the sector table

Reuse `benchmarks`: give each named company a row on the KPI with `p25 = median = p75 = its value`, a `source_key` naming the company and `basis` naming the report. No new table, no new block; the card lists the point rows.

**Pros**:
- Zero schema work; the seed, the gate and the two flags already exist.
- The rung ladder of spec 0008 would pick the row.

**Cons**:
- `benchmarks` is keyed by `(kpi, section, band, year)`, so two companies in one section and band collide; the identity of a company has no home.
- Peer selection takes the first rung with any row and one row per KPI, so a named company would silently replace the sector spread instead of standing beside it.
- No headcount, no country per row, no rank: the honesty labels the design needs have no column.

### Option 2: A curated library in two global tables, chosen by a pure ladder in the existing model, copied into the snapshot (chosen)

`peer_companies` and `peer_figures` as global reference tables seeded from CSV on the same rails as the sector values; the task loads the client's section, verified figures only, and hands them to `computeBenchmark`; the model runs the geography ladder, ranks, prices the client's saving at each peer and writes a `peers` block into the snapshot; the card and the chart read the block.

**Pros**:
- Every honesty rule becomes structural: verified only at the task, one section at the task, no peer cost in the block.
- The same seed, gate, snapshot and recompute rails the owner already operates; curation is a CSV diff.
- The snapshot copy means a later library edit never changes what a client was shown.
- The block shape leaves room for the cohort ring as a second row kind.

**Cons**:
- Two tables, a jsonb column, a model version and a chart component: a full slice, about the size of spec 0016.
- Curation by hand is the bottleneck; the library is empty for any industry nobody has read yet.
- A recompute after the seed lands, explained to clients once.

### Option 3: A live lookup at read time

Store the library, but skip the snapshot block: the dashboard query joins the library to the client's KPIs when the page renders and computes the rank in the reader.

**Pros**:
- No model version bump, no recompute; a new peer shows on the next page load.

**Cons**:
- Breaks the one rule every benchmark number has obeyed since spec 0008: what the client saw is what the snapshot holds. A later library edit or a retired peer would change a card the client already quoted.
- The saving per peer needs the cost model's arm, FTE and assumptions, which live in the snapshot; the reader would re run the model.
- Two places compute, and the email could never carry the rank.

### Option 4: Draft the library with the research provider from day one

Point the Parallel provider at company reports with a peer prompt and let ops verify drafts in an admin page, shipping the assist and the page in this slice.

**Pros**:
- Scales curation across Europe: ESRS reports put the figure in a fixed place, one prompt reads them all.

**Cons**:
- Two more surfaces (a prompt and an ops page) before the first client sees a peer; the slice doubles.
- The first two sections are readable by hand in an afternoon each, which also teaches what the prompt must extract.

## Rationale

Option 2 is chosen because the feature is a benchmark feature and the benchmark already has a working honesty architecture: stored rows in, a pure function, an immutable snapshot, one card. Option 1 is the tempting shortcut and fails on identity: a named company is a thing with a country, a size and a source page, and `benchmarks` has no place for any of them; worse, the rung ladder would let a named row silently stand in for the sector spread. Option 3 trades the snapshot guarantee for freshness, and freshness is not what the owner asked for; a client quotes the number they saw, so the number must be stored. Option 4 is where the library goes once it is bigger than one person's afternoons, and it is a follow up rather than a rejection.

The four owner calls follow the same principle, honesty by labelling rather than by exclusion. Larger listed peers are accepted because the row shows the headcount, the chart makes size visible as area, and the heading says "that publish"; a size ceiling would empty most industries under three. The ladder climbs to the world because the pool is deepest there and the rung is written under the table; stopping at Europe would leave TRIFR thin for years, and a client control adds state for a choice the sentence already explains. Money is priced at every peer the client is behind because that is the scope's done line and the natural reading of the table; it stays on the client's row only, on the KPI's own arm on both sides, so an LTIFR saving never mixes with the Suva rate arm the headline may use. The chart goes to the client rather than the expert because its accessibility (a focusable element per bubble, an sr only table) is specified, and an expert only chart would be the same component behind a different route; it ships as its own slice because it needs three peers with both LTIFR and lost days, which the first curation may not yield, and the block already carries what it needs.

Verification is a person's name and a timestamp, not a boolean, because the gate needs to say what has not been read, and a curator's initials on a row is the same discipline the sector seed uses with `provisional`. The freshness window of three report years keeps a 2021 figure out of a 2026 comparison without emptying the pool; the year is on the row either way. Employees only wins when a company prints both bases because a client's own figure, whether researched or typed, is almost always an employees figure; the other basis stays in the data and is not ranked twice.

The chart, now its own slice, is hand drawn SVG because the quartile band already set the precedent (spec 0008) and because per bubble keyboard focus, a tooltip on focus and an sr only table are one component's job in SVG and a fight in a charting library's scatter shapes. Rank counts strictly better peers so equal values share a rank, the rule a reader expects from any league table. The chart's six are the nearest in headcount because size is the one axis the card cannot otherwise show; a random six would put a 40 000 person group next to a 300 person client for no reason. Units convert at seed time so `value` is always comparable and no reader ever multiplies; the published value stays beside it for the tooltip. The block is its own jsonb column rather than a key inside `results` because `results` is one entry per KPI row the client has, while peers can exist for a KPI the client has no value for (listed, no rank). This spec takes `@5` because it builds first; spec 0020 moves to `@6` and adds the currency to the saving column when it lands.

## The region map

Every European code belongs to exactly one region. `regionOf` reads this table; the client's region is `regionOf(companies.country)`.

| Region | Codes |
|---|---|
| `dach` | CH, DE, AT, LI |
| `nordics` | DK, FI, IS, NO, SE |
| `benelux` | BE, NL, LU |
| `british_isles` | GB, IE |
| `southern` | FR, IT, ES, PT, GR, MT, CY |
| `central_eastern` | PL, CZ, SK, HU, RO, BG, HR, SI, EE, LV, LT |

France sits in `southern` for want of a better home; if a French pilot arrives, the map is one line to change and the snapshot copies mean nothing shown moves.

## What the first curation reads

For sections C and F, the sustainability or annual reports of listed European manufacturers and construction groups, 2023 or later, that print an LTIFR or TRIFR (per million hours, or per 200 000 hours in US style reports) with the basis stated. Each row records the exact page or PDF as `source_url`, the reporting page as `report_url`, the headcount and its year, and the curator's name and date. Where the same report prints lost days per incident or an ISO 45001 statement, those rows come along. Nothing is entered from a third party aggregator; the source is the company's own report.

## The chart slice

Recorded here so the next scope row builds from it without a second design pass. One hand drawn SVG client component `src/features/benchmark/ui/peer-bubble-chart.tsx` under the positions, drawn once for the KPI pair `ltifr` across and `lost_days_per_incident` up, bubble area by `headcount`, using the `ltifr` block's `chart` from the snapshot (the block's peers that also have a lost days figure, at most six, nearest headcount to the client, ties to the latest year); the client's bubble always drawn; a dashed line at the client's lost days sector median when the snapshot has that sector row, labelled "sector median" (the forbidden word test exempts `benchmark.peers.chart.*` for this one word); the `chart-1` to `chart-3` tokens; a tooltip on hover and on keyboard focus, a visible focus ring per bubble, a `role="img"` label `benchmark.peers.chart.label`, an `sr-only` table with caption `benchmark.peers.chart.tableCaption` and the same rows, and no motion under `prefers-reduced-motion`. Hidden with one sentence when there is no `ltifr` block, when the client lacks either figure, or when fewer than one peer has both. Gate: the committed curation yields at least three peers with both figures in section C; until then the row waits. Gallery section and axe as for every primitive.

*Amended 13 Sep 2026.* Two things in the paragraph above did not survive contact with the data, and the index carries the corrected contract as AC-18 to AC-25. First, "no model bump" was wrong: `chart.peerKeys` names the peers but a peer's lost days value reaches the snapshot only inside a `lost_days_per_incident` block, and that block exists only with three peers, while the chart is meant to draw with one or two. Keys without values are not a contract a component can draw from, so the block widens to the points (`client` and `points`, AC-20) and the widened block is `benchmark-model@6`. Second, the gate assumed companies print an average of days lost per accident, and none does; the section below records why and what was decided instead.

## The lost days question

The reading of 13 Sep 2026 (two agents over about thirty European C and F reports; the verdicts per company are in `docs/benchmark.md` under "What is readable, and where") found exactly one company that prints days per accident, Goldbeck, whose rate is per 1 000 employees and so cannot sit on the LTIFR axis. The reason is structural: ESRS S1-14 88(e) asks for the number of days lost, a total, and never the average, so a report that follows the standard prints the total, and several groups cite the transitional provision and print nothing yet. Four reports print both ingredients of the average in one table for one population: the days lost and the count of lost time accidents (Geberit, Symrise, Covestro, Vinci). Others print days over recordable cases (BASF, STRABAG, Hochtief, ABB), a numerator that mixes illness (Georg Fischer), a three year rolling count (Eiffage), or a severity rate per million hours (Sulzer, Heidelberg Materials), which is a different KPI.

### Option 1: A quotient of two printed numbers, as its own unit (chosen)

Allow a peer figure that is the generator's division of two numbers printed in one table of one report for one population and one period, stored as a fifth unit with both printed numbers on the row, divided in `seed-schema.ts` and never by hand, with both numbers in every tooltip and a note field for what changes the reading (Vinci's fatality charge).

**Pros**:
- The chart's axis stays the KPI the client already has (`lost_days_per_incident` is in the catalogue, the fixture, the cost model and the sector rows), so the client's own bubble, the sector line and the peer points share one unit.
- The honesty rule bends by exactly one operation and the row shows its working: a reader who opens Geberit's report finds 2 275 and 111, and the tooltip says so.
- It follows the one precedent already in the generator, the per 200 000 hours times five conversion: a published pair becomes a value in code, with the published form kept beside it.
- ESRS reports print the total days lost by mandate, so the pool of quotient rows grows with every FY2025 report that also prints its accident count.

**Cons**:
- It is the first figure in the library the company did not print as such; a strict reading of "value as published" is gone and the tooltip has to carry the explanation.
- Reports differ in what a day is (calendar or working, capped or charged for a fatality) and the note is prose, not a normalised field; the ranking does not adjust for it.
- Four rows today, one of them (Vinci) inflated by a 365 day charge per fatality; the F chart draws one peer.

### Option 2: Move the Y axis to a severity rate per million hours

Change the chart's vertical axis to days lost per million hours worked (the severity rate some groups print), with a new KPI or a new peer unit for it.

**Pros**:
- Sulzer, Heidelberg Materials, Vinci and Eiffage print a severity rate as such, no division needed for them.
- A rate per hours worked is the natural partner of an LTIFR on the same axis system.

**Cons**:
- The client has no such figure: the research prompt, the self assessment form and the fixture produce days per incident, so the client's own bubble would need a derived value (days per incident times incidents over hours), which is more arithmetic than Option 1 and on the client's side.
- The printed severity rates disagree on the denominator (per 1 000 hours at Vinci and Eiffage, per million at Sulzer), so a conversion step arrives anyway.
- A new KPI touches the catalogue, `kpi_definitions`, the peer KPI check, the sector rows and the cost model for one chart.

### Option 3: Park the row

Leave scope row 32 gated until companies print the average, and ship the table's headcount column as the only picture of size.

**Pros**:
- No bend in the honesty rule, no model version, no recompute.

**Cons**:
- The gate never opens: the standard mandates the total, so the average will not appear in reports.
- The Peer Standing page promised the picture and the owner put the chart on the client page from the start.

### Why Option 1

The forces are the ones the whole spec rests on: one pure calculation over stored rows, every number with a named source, and the client's own figures as the anchor of every comparison. Option 1 keeps the client's KPI as the axis and adds one operation whose inputs are printed and stored; Option 2 moves the arithmetic to the client's side, where it is least checkable, and still needs a conversion; Option 3 waits for something the reporting standard says will not come. The safeguards that make the bend acceptable are structural, not editorial: the unit exists only on `lost_days_per_incident`, the database ties the denominator to the unit, the division is code with a pinned test, the denominator is defined as lost time accidents (the count the company's own LTIFR divides by) so days over recordable cases can never enter, and both numbers are in every tooltip. The note field exists because a fatality charge of 365 days is a fact about the number that no field can normalise and that a reader must see beside it.

The version call: the chart takes `@6` and spec 0020 moves to `@7`, because the chart's data is in hand and its block is designed here, while spec 0020 is `Proposed` with no code on any branch; a bump is a literal key in one map, so the renumbering is a search in one spec. A widened block is a new version because a stored `@5` row has `chart.peerKeys` and a `@6` row has `chart.points`, and the one map rule of spec 0012 says a reader never guesses which. The recompute that follows is the known cost of the literal map and is booked in the runbook like the `@5` one.

The curation call: the six new rows carry the agent read marker rather than an empty pair, against the runbook's advice for future additions, because an agent did read the cited tables (page numbers are on the rows) and because the chart cannot be proven end to end on rows the task skips. The owner's re-read before promotion covers them with the first ten; if the owner prefers the empty pair, the e2e proves the hide sentence and the Vitest fixture proves the drawing, and nothing else changes.

## Cross check of the chart amendment, 13 Sep 2026

A second read only pass on a different model reviewed the amendment; the owner applied every recommended fix. Folded into AC-18 to AC-25: the upsert renderer's column list, the no grant note for additive columns, the optional third parameter of `publishedValueOf`, the widened `days` refine, the rounding expression and the numeric pgTAP band, the duplicate `days` and quotient row check, the axis scale rule from `PeerStrip`, `keptFigures` as the source of a point's lost days and `chartPoints` replacing `chartPeerKeys`, the two block schemas with a transform for `@5`, server side number formatting against the ICU grouping hydration hazard, and the sector line's absence when the client has no lost days row. The three calls the owner made: a client without FTE is drawn at the floor area rather than hidden; the client's lost days is never the cost model's default assumption; the chart's points stay the LTIFR rung's population even when that leaves a Swiss client one bubble, and the e2e asserts one peer bubble while the Vitest fixture proves three. Two suggestions were declined: a mandatory note on every quotient row (the tooltip already shows both printed numbers, and a note that repeats them is noise beside Vinci's, which says something) and the simpler shape of a nullable `lostDays` on the table rows instead of a chart block (it moves the six nearest selection to render time and drops the client's point from the snapshot, against the rule that the snapshot holds what was shown).

## Cross check of 13 Sep 2026

A read only pass on a different model reviewed the draft; the owner chose to apply every resolution. Folded in: the country name comes from `countryName` (no message existed), the catalogue is built whole so spec 0020 only consumes it, the rank null rendering, the saving computed inside the model on the KPI's own arm (the stored cost block lacks the multiplier and may have used the Suva arm), one no saving message, the ISO share without the client, ties for `best`, numbered seed counts asserted as at least, the three `sr-only` keys, the whole table rule for retirement, the by hand grant read for the new column, the forbidden word test scoped so the chart may say "sector median", the field renamed `geoRung`, an unknown client country landing on `world`, AC-12 and AC-15 made checkable, and spec 0020's version references moved to `@6`. Its one design suggestion, shipping the chart as its own slice because the first curation may not yield three peers with both figures, the owner accepted.

## References

**Project sources** (verifiable, in this repo):
- Spec 0008 (the task, the pure model, the snapshot blocks, `QuartileBand` as hand drawn SVG).
- Spec 0012 (the literal version map in `SNAPSHOT_SCHEMAS`).
- Spec 0016 and its amendment (point rows never say median; `provisional` and `is_assumption`; the two gate queries; the recompute discipline).
- Spec 0020 (the country and currency contract; `src/lib/countries.ts` as the one catalogue; this spec takes `@5` and, with the chart amendment, `@6`; 0020 takes `@7`).
- `src/features/benchmark/AGENTS.md` and `docs/benchmark.md` (the seed generator, the gate, the confirmed dead ends for LTIFR and TRIFR, and the lost days reading of 13 Sep 2026 under "What is readable, and where").
- The memory of the `/develop peer bubble chart` run of 13 Sep 2026 (the per company verdicts, the page references), folded into `docs/benchmark.md` so the reading is never repeated.
- The Peer Standing design page (artifact `3ef5da7c-9080-44f9-8405-b49b75a2cbc5`, indexed in the local `docs/artifacts/README.md`).
- `docs/design.md` (charts monochrome first, `chart-1` to `chart-5`, the quartile band primitive, the gallery rule).
- Installed skills: `supabase-postgres-best-practices`, `supabase`, `trigger-tasks`, `next-intl-app-router`, `vitest`, `playwright-skill`, `frontend-design`.

**Practices & standards**:
- GRI 403 (occupational health and safety) and ESRS S1 (own workforce), the two reporting standards that make published injury rates comparable across companies; ESRS S1-14 88(e) in particular, which asks for the total days lost and is why no report prints the average.
- NACE Rev. 2 sections as the industry axis every European report and statistic already uses.
- Immutable, versioned snapshots: what a client saw is what the store holds.
- A geography ladder that widens the place before the industry, because a peer in the same industry elsewhere is closer than a peer in another industry next door.
- WCAG 2.2 AA for data graphics: a focusable element per data point, a text alternative that carries the same information.
