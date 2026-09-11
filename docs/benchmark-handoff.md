# Peer benchmark: what is wrong, what is missing, what to do

A working document, not a spec. Written 12 Sep 2026 from a review of `docs/benchmark.md`,
the seed CSVs, `src/features/benchmark/model.ts`, the feature 9 / 16 / 27 reviews, and a
verification pass over the public statistical sources the seed names.

Its job is to get the peer benchmark to a quality we can put in front of a pilot client
without flinching. It is deliberately short on new machinery: almost everything below is
data work and labelling, not code.

Read `docs/benchmark.md` for how the model works. This file only covers what is wrong with it.

---

## 1. Three things we wrote down that are not true

These are in `docs/benchmark.md` as settled conclusions, in the section headed "What the
research for spec 0016 confirmed is unreadable". Whoever picks this up next will trust them.
They are wrong, and the cause is the same in all three cases: **we only looked at Swiss
sources. Switzerland is in the European statistics database.**

| What the doc says | What is actually true |
|---|---|
| "No fatality rate ... is published by sector" (`:186`) | Eurostat `hsw_n2_02` publishes CH fatal accident rates by NACE sector. CH 2023: 48 fatalities, rate 1.13 per 100 000; construction 4.94; agriculture 17.36. |
| "No Swiss source publishes safety outcomes by company size band" (`:184`) | Eurostat `hsw_n2_05` has CH accidents by NACE **× enterprise size** (1–9, 10–49, 50–249, 250–499, ≥500). Our `size_band` column has real data available. |
| `lost_days_per_incident` "Uncovered" from Suva (`:110`) | Correct that Suva has nothing — a full-text search of UVG-Statistik 2026 for *Absenztage, Ausfalltage, Arbeitsunfähigkeitstage, Fehltage* returns **zero** hits. But Eurostat `hsw_n2_04` publishes days-lost bands by sector for CH. |

The client-facing note for `lost_days_per_incident` compounds this: it tells clients the figure
is "derivable from the Suva tables", which it is not. The 14-day default in the seed was derived
from *cost ratios*, and that derivation does not extend per sector.

**Action:** correct all three in `docs/benchmark.md`, flip `fatalities` from `no_source` to
`pending` in `KPI_CATALOGUE`, and fix the `lost_days_per_incident` peer note in both catalogs.

## 2. The peer data is two editions stale

We seed from **UVG-Statistik 2024**, carrying **2022** figures. The current edition is
**UVG-Statistik 2026** (`https://www.unfallstatistik.ch/d/publik/unfstat/pdf/Ts26.pdf`),
carrying **2024** sector data. Table 1.2 is the one we read.

The all-industry rate moved **61.8 → 58.2**. Swiss workplaces genuinely got safer, so every
client today is measured against a bar that is too lenient, and every CHF opportunity figure
is correspondingly overstated.

Two things to preserve when re-reading:

- **BUV column only.** Table 1.2 splits occupational (BUV) from non-occupational (NBUV). Only
  BUV measures safety performance. The NBUV column sometimes *inverts* the ranking — finance
  145.5 vs construction 130.8 — because office workers ski. The current seed is correct on
  this; keep it that way and say so in the row notes.
- **The quartiles are still class spread, not company spread.** See §4.

## 3. What is actually obtainable, verified

Checked against the live sources, not from memory. "Verified" means the table was fetched and read.

| KPI | Status | Source |
|---|---|---|
| `accident_rate_per_1000_fte` | have it, needs refresh | Suva UVG-Statistik 2026, Table 1.2 (verified) |
| `lost_days_per_incident` | **newly available** | Eurostat `hsw_n2_04`, CH to 2023 (verified) |
| `fatalities` | **newly available** | Eurostat `hsw_n2_02`, CH to 2023 (verified) |
| company size bands | **newly available** | Eurostat `hsw_n2_05`, NACE × size (verified) |
| `absenteeism_rate` | probably | BFS series exists for 2025 but is published as a *chart*; the DAM API returned 404 for both asset ids. **Unconfirmed whether a data file exists.** |
| `iso_45001_certified` | no | ISO Survey 2024 sector data is broken (certificates largely lack sector designation); CH count needs an IAF CertSearch login |
| `ltifr`, `trifr` | no public peer | Switzerland reports per 1 000 FTE, not per million hours. No Swiss peer LTIFR exists. |
| `near_miss_rate` | no public peer, anywhere | Not collected by any national body in any country |

**Realistic ceiling from public data: 4 of 8 KPIs, plus a size dimension.** Today we have 1.

Two caveats to carry into the seed rather than silently absorb:

- **Denominator mismatch.** Eurostat is per 100 000 *employed persons*; ours is per 1 000 *FTE*.
  That is not a clean ÷100 — it is a different denominator. Record it in `basis`.
- **Do not build a "Switzerland is dangerous" claim.** Raw CH numbers look worse than the EU
  (2 345 vs 1 392 per 100 000), but the EKAS/ZHAW 2025 report states this is a reporting-regime
  artefact: simulate the Swiss reporting system across all countries and Switzerland lands at
  the average.

## 4. The quartile problem is half-fixed

Suva publishes **one average per industry class**, not a distribution of companies. Our p25/median/p75
is therefore the spread **across sub-industries**, which is much narrower than the spread across
companies. A client reading "a quarter of companies like me sit below 34.9" is reading something
we did not measure.

Spec 0016 handled the worst case well: where a section holds one Suva class, all three quartiles
are equal, the code detects that, renders a plain sector average with no band, and bans the words
quartile/median/quarter in both languages with a test enforcing it. **That covers 11 of 22 rows.**

The other 11 still draw a real-looking quartile band over class-average spread. And the caveat the
curator wrote is stored in `source_note` and **never rendered** — it is not copied into the snapshot.
The client sees confidence where the database holds doubt.

**Action:** relabel the 11 distribution rows honestly ("range across sub-industries in your sector"),
and render `basis` on the card. The columns already exist and are empty on every row.

## 5. What the CHF figure actually rests on

Worth stating plainly because the eight-row table implies otherwise.

The franc headline is computed from **two** inputs, not eight:

- one incident rate — the Suva accident rate, *else* LTIFR (`accidentRate ?? ltifr`)
- lost days per incident — the client's, else the 14-day default

`COST_LINKED_KPIS` names three keys, but `trifr`, `absenteeism_rate`, `near_miss_rate`,
`fatalities` and `iso_45001_certified` contribute **nothing** to the money. They show a position
and a gap and stop there.

Two consequences:

- `lost_days_per_incident` is half the calculation and currently has **no peer row**, so for most
  clients half the cost model runs on one economy-wide constant. Fixing it via Eurostat improves
  the headline twice over: once through the client's own position, once through the median reference.
- We display a derived **recordable injury count** (from TRIFR) and then exclude it from the cost.
  A client who reads "about 6 recordable injuries a year" beside a figure that does not include them
  will ask why. Simplest honest fix: one line in the disclosure saying the model prices lost-time
  incidents only.

## 6. The multiplier, and what not to do about it

The `indirect_multiplier` is the biggest single lever on the headline and has no publishable source.
Confirmed: no Swiss body publishes an indirect-to-direct ratio (the EKAS/ZHAW 2025 report names the
cost categories and never quantifies a ratio), and no European body does either — EU-OSHA's work is
societal burden modelling, not a company-level ratio.

So the low/high bracket is ILO 2007 and **Heinrich (1931)**, and the middle 3.7 is our own estimate
from a US figure quoted in a training course.

**Trap to avoid:** the ISSA "Return on Prevention" study (Switzerland participated) reports **2.2**.
That is a return on *prevention investment*, not an indirect:direct cost ratio. The two get conflated
constantly. Do not let 2.2 into the seed as a multiplier.

The two-flag design (`provisional` vs `is_assumption`) is the right answer here and should stay. It
is the reason the gate can pass at all — the original single-flag gate could never have passed,
because the multiplier can never be read from anywhere.

Related: `direct_cost_per_case_chf` (CHF 4 811) is one of our better-sourced numbers, but it is a
**mean**, and Suva warns the cost distribution is brutally skewed — the most expensive 1% of cases
cause nearly half of all costs. For a typical SME whose accidents are sprains and cuts, the median
case costs far less. This argues for keeping the range framing rather than adding more point estimates.

## 7. Research-assembled peer sets

We have generated a peer card of twelve named global mining companies — LTIFR each, all on 2025,
all flagged "incl. contractors", with an industry median and a peer median distinguished — entirely
from AI research.

That is a stronger result than the pipeline's reputation suggested, and it reaches exactly the KPIs
public statistics never will: LTIFR, TRIFR, contractor-inclusive rates. Getting the normalisation
basis right per row is the detail that makes it credible; mixing employee-only and contractor-inclusive
rates is the classic error in safety benchmarking and it avoided it.

Two constraints that do not go away:

- **It works because those companies publish.** The method's reach is bounded by disclosure. A Swiss
  sector whose largest firms are private returns two companies or none.
- **Survivorship bias, and it gets worse as the research gets better.** Companies publish safety
  numbers when they are proud of them. A research-assembled median is therefore systematically better
  than the true population median, which inflates our CHF opportunity. This is manageable by labelling
  — "median of 12 companies that publish LTIFR" is honest, "industry median" is not — but it must be
  labelled, not assumed away.

**Unanswered, and it decides how far this scales:** does the research *select* the peer set itself, or
was the list of twelve supplied? And how does it behave when only four companies disclose — does it say
so, or does it present four with the same confidence as twelve? The second is a bigger credibility risk
than any data gap in this document. Worth one deliberate test on a Swiss sector with poor disclosure.

If it selects and it degrades honestly, **pre-building one peer set per sector** (≈20 research runs,
cached as peer rows, refreshed annually) changes the economics entirely — it stops being a per-customer cost.

## 8. The card

The dot plot from the mining report is the right form and we should move toward it — it shows every
observation, handles small N gracefully, and degrades honestly (three dots read as thin; a quartile
band over three points still looks confident). What makes it work is not the graphic:

- it **names** the peers, so the client can verify and quote it
- it shows **N** ("of 12 ranked companies")
- it carries the **normalisation caveat** per row ("incl. contractors")
- it **ranks** ("1st of 12") rather than bucketing ("top quarter")

Of these, showing N is the one to adopt immediately and costs nothing.

**But do not put a dot plot on the current data.** Plotting 12 sub-industry averages as if they were
12 companies would be a downgrade in honesty from the band. The chart becomes right once the data is
a real population. Fix the data, then the chart.

Naming SME peers is not available to us the way it is for listed miners — twelve named Swiss SMEs with
their accident rates on a dashboard is a data-protection problem as well as a commercial one. The
realistic shape is three tiers:

| Client | Card | Needs |
|---|---|---|
| large, listed competitors | named dot plot | research, buildable now |
| SME, sector has client data | anonymised dot plot, "4th of 18" | ~30 clients in sector, min-group floor of ~5 |
| SME, nothing | sector average, labelled as such | what we have today |

## 9. Open decisions

Both were raised in review and never answered. Neither is a developer's call.

- **A peer p25 of 0 reports "no reference".** A safest-quarter of zero recordable incidents is a
  meaningful, likely value, and its correct reading is that reaching the top quarter saves the whole
  annual cost. We currently show "no reference" in exactly the case with the largest opportunity.
  AC-18 says `null` "when that peer value is 0", so the code follows the spec — but the rule looks
  like it was aimed at a missing median, not a legitimate zero.
- **Should single-class sections show a comparison at all?** Eleven sections currently show a sector
  average derived from one Suva class. Honest, but possibly not worth showing.

## 10. What to do, in order

Sequenced so the free, defensible work lands first. Nothing here is a rebuild.

**A — correctness and honesty (about a day)**

1. Fix the three wrong conclusions in `docs/benchmark.md`; flip `fatalities` to `pending`; fix the
   `lost_days_per_incident` peer note in both catalogs.
2. Fix the `NaN` guard — `costAt` reads `values.hours_per_fte` unguarded, so a missing assumption row
   yields `NaN` in the CHF figure. Give ops a named cause instead of "expected number, received NaN".
3. Reconcile the stale runbook: three `@2` references where the code is `@3`, and a worked example
   saying CHF 1 961 000 where the committed seed gives CHF 2 135 737. Consider testing these the way
   `runbook.test.ts` already tests the gate line.

**B — the data (the highest-value block)**

4. Re-read Suva Table 1.2 from UVG-Statistik 2026 (BUV column). Clears most provisional flags and
   fixes the stale bar.
5. Add the three Eurostat datasets: `hsw_n2_04` (lost days), `hsw_n2_02` (fatalities), `hsw_n2_05`
   (size bands). Takes us from 1 KPI to 4 plus a size dimension. Record the denominator mismatch in `basis`.
6. Resolve `absenteeism_rate`: confirm whether BFS publishes a data file or only a chart. If a file
   exists this is a fifth KPI; if not, say so on the card instead of "not yet".

**C — what the client sees**

7. Render `basis` and `source_key` on the card. Show N everywhere.
8. Relabel the 11 distribution rows as sub-industry spread.
9. One disclosure line: the cost model prices lost-time incidents only.

**D — decisions, then the strategic work**

10. Answer §9.
11. Test the research peer-set behaviour on a thin-disclosure Swiss sector (§7). If it degrades
    honestly, pre-build one peer set per sector.
12. Client-data benchmarking: consent, a minimum-group floor, then the anonymised dot plot. This is
    the durable moat — no public source and no competitor can offer real SME peer distributions —
    but it only starts compounding once we are selling.

**Do not do:** adopt the 25–50k / 5–15k injury cost bands from the two-tier model we looked at. They
are unsourced, and they price a recordable injury *above* a lost-time injury, which is backwards.
Swapping a sourced Swiss figure for those would move us backwards on exactly the honesty dimension
spec 0016 was written to fix.

## 11. One thing to check first

Scope row 25 is marked `done`, and its own "Done when" requires *"one watched
`pnpm benchmarks:recompute` has moved every snapshot to `benchmark-model@3`"*. Spec 0016's follow-up
still says "Watch the recompute after deploy rather than firing and forgetting", and spec 0012's
`verify.md` post-deploy recompute box is unticked.

So either the recompute happened and two specs were not updated, or the row was ticked ahead of the
work. Feature 26 (go-live) is gated on feature 25 being genuinely done, and if snapshots are still on
`@1`/`@2` then clients are seeing cards computed under older rules. Ten minutes to resolve, and it
changes what "done" means on the board.

---

## The summary

The engineering is good — pure arithmetic, immutable versioned snapshots, a real launch gate, and a
two-flag honesty design that is the best thinking in the feature. None of the above is a criticism of
the code.

The data is a prototype: one sourced KPI of eight, 22 rows, one year, no size banding, sub-industry
averages presented as company quartiles, and a headline resting on a disputed 1931 ratio.

We are about a week of data work from a defensible product, not a rebuild. Public data alone takes us
from one comparable measure to four with size banding. What makes it a business rather than a
calculator is §7 and item 12 — peer sets we assemble and client data we accumulate — and neither needs
to happen before launch.
