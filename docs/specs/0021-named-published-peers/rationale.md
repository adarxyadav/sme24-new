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

Recorded here so the next scope row builds from it without a second design pass. One hand drawn SVG client component `src/features/benchmark/ui/peer-bubble-chart.tsx` under the positions, drawn once for the KPI pair `ltifr` across and `lost_days_per_incident` up, bubble area by `headcount`, using `chart.peerKeys` from the snapshot (the `ltifr` block's peers that also have a lost days figure, at most six, nearest headcount to the client, ties to the latest year); the client's bubble always drawn; a dashed line at the client's lost days sector median when the snapshot has that sector row, labelled "sector median" (the forbidden word test exempts `benchmark.peers.chart.*` for this one word); the `chart-1` to `chart-3` tokens; a tooltip on hover and on keyboard focus, a visible focus ring per bubble, a `role="img"` label `benchmark.peers.chart.label`, an `sr-only` table with caption `benchmark.peers.chart.tableCaption` and the same rows, and no motion under `prefers-reduced-motion`. Hidden with one sentence when there is no `ltifr` block, when the client lacks either figure, or when fewer than one peer has both. Gate: the committed curation yields at least three peers with both figures in section C; until then the row waits. Gallery section and axe as for every primitive. No model bump: the block already carries `chart.peerKeys`.

## Cross check of 13 Sep 2026

A read only pass on a different model reviewed the draft; the owner chose to apply every resolution. Folded in: the country name comes from `countryName` (no message existed), the catalogue is built whole so spec 0020 only consumes it, the rank null rendering, the saving computed inside the model on the KPI's own arm (the stored cost block lacks the multiplier and may have used the Suva arm), one no saving message, the ISO share without the client, ties for `best`, numbered seed counts asserted as at least, the three `sr-only` keys, the whole table rule for retirement, the by hand grant read for the new column, the forbidden word test scoped so the chart may say "sector median", the field renamed `geoRung`, an unknown client country landing on `world`, AC-12 and AC-15 made checkable, and spec 0020's version references moved to `@6`. Its one design suggestion, shipping the chart as its own slice because the first curation may not yield three peers with both figures, the owner accepted.

## References

**Project sources** (verifiable, in this repo):
- Spec 0008 (the task, the pure model, the snapshot blocks, `QuartileBand` as hand drawn SVG).
- Spec 0012 (the literal version map in `SNAPSHOT_SCHEMAS`).
- Spec 0016 and its amendment (point rows never say median; `provisional` and `is_assumption`; the two gate queries; the recompute discipline).
- Spec 0020 (the country and currency contract; `src/lib/countries.ts` as the one catalogue; this spec takes `@5`, 0020 takes `@6`).
- `src/features/benchmark/AGENTS.md` and `docs/benchmark.md` (the seed generator, the gate, the confirmed dead ends for LTIFR and TRIFR).
- The Peer Standing design page (artifact `3ef5da7c-9080-44f9-8405-b49b75a2cbc5`, indexed in the local `docs/artifacts/README.md`).
- `docs/design.md` (charts monochrome first, `chart-1` to `chart-5`, the quartile band primitive, the gallery rule).
- Installed skills: `supabase-postgres-best-practices`, `supabase`, `trigger-tasks`, `next-intl-app-router`, `vitest`, `playwright-skill`, `frontend-design`.

**Practices & standards**:
- GRI 403 (occupational health and safety) and ESRS S1 (own workforce), the two reporting standards that make published injury rates comparable across companies.
- NACE Rev. 2 sections as the industry axis every European report and statistic already uses.
- Immutable, versioned snapshots: what a client saw is what the store holds.
- A geography ladder that widens the place before the industry, because a peer in the same industry elsewhere is closer than a peer in another industry next door.
- WCAG 2.2 AA for data graphics: a focusable element per data point, a text alternative that carries the same information.
