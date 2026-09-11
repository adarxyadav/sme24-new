# 0016. Peer data curation and model honesty: rationale

Reasoning, options and evidence behind [index.md](index.md). `/develop` skips this file.

## Context

> ⚠️ Premise note: scope row 25 says this work is "data work with the scripts that already exist, not a new design" and carries no `Design it (spec)` box. That premise is wrong, and the three questions asked of this spec are the evidence. The row assumes every provisional value has a published Swiss source waiting to be read, so replacing them is clerical. Research done for this spec establishes that the indirect cost multiplier has no such source and never will, that no Swiss source publishes safety outcomes by company size band, and that the Suva accident tables are not published on the NOGA axis the schema is keyed by. A curation pass run on the row's premise would either stall at the first unsourceable value or quietly invent one. The right framing is that the launch gate cannot be satisfied without first deciding what the product is allowed to claim.

The benchmark shipped in spec 0008 with a deliberate and well recorded compromise: the arithmetic is real, the data is a provisional first reading, the dashboard says so, and production carries a checkable gate of zero provisional rows. That framing held as long as "provisional" meant "not yet read from its source". Feature 25 is where the flag is supposed to clear.

Three forces break that plan.

**The cost model rests on a premise no source supports.** The annual CHF figure is incidents times cost per case times `indirect_multiplier`, seeded at 3.7 from a US National Safety Council ratio cited second hand in an OSHAcademy training course, bracketed by 2 (ILO) and 5 (Heinrich 1931). The seed file itself records the intent to replace it with "a Swiss or European estimate". No such estimate exists. The multiplier therefore cannot clear the provisional flag by being read from anywhere, and the gate as written can never pass.

**The peer axis is not the axis the sources publish on.** `benchmarks` is keyed by NOGA section letter and size band. The UVG accident tables are published on Suva's own premium class scheme, roughly forty one classes with codes like `01B` and `22A`, which is a risk tariffing structure rather than a NOGA derived one, with no authoritative published crosswalk. Separately, no Swiss source publishes accident or absence rates by company size at all: the size axis exists only on the denominator side in STATENT establishment counts. Every one of the twenty two seeded rows is correctly `size_band = 'all'`, and permanently so.

**Eleven rows describe a distribution that was never measured.** Where a NOGA section maps to a single Suva class, the seed put that one class mean into `p25`, `median` and `p75` alike. The committed `source_note` says so honestly. But `source_note` is never copied into the snapshot and never rendered, so the caveat dies in the database. What the client sees instead is a `QuartileBand`, a position band reading "Top quarter" or "Bottom quarter", and a screen reader sentence naming three identical quartiles as a peer distribution. Sections A, B, D, E, L, O, P, R, S, T and U are all in this state. The fixture company is NOGA 23.61, section C, which has real spread, so the full GA workflow, Vitest, Playwright and axe included, never exercises the path.

The consequence of not deciding is that the launch gate is reached and then either fails permanently on a value that cannot be sourced, or is quietly widened until it stops gating anything, while eleven sectors keep reading a quartile claim about a single number.

## Options considered

### Option 1: Curate harder and keep the model as it is

Treat the row's original premise as correct: find better sources, replace what can be replaced, and accept the rest by clearing the flags with a documented note.

**Pros**:
- No code change, no schema change, no new model version, no recompute.
- Ships fastest and keeps the single franc headline, which is the stronger sales figure.

**Cons**:
- The multiplier still has no source, so clearing its flag makes an assumption indistinguishable from a sourced value in the data. That is precisely the confusion that produced this spec.
- The eleven degenerate rows keep claiming quartiles. Curation cannot fix them, because the underlying source genuinely publishes one number per class.
- The gate stops being a gate: it passes because the flags were cleared, not because the data got better.

### Option 2: Withdraw the claims that cannot be supported

Drop the CHF figure until a defensible multiplier exists, and show no peer comparison for a section without a real distribution.

**Pros**:
- Unimpeachably honest. Nothing on screen outruns its evidence.
- Smallest surface to reason about: fewer states, no new positions, no shape marker.

**Cons**:
- Removes the product's headline claim and the whole marketing premise, which is a franc figure benchmarked against peers. The free benchmark is the lead magnet.
- Overcorrects. The arithmetic is sound and four of the five cost inputs are genuinely sourced; only the multiplier is an assumption. Discarding the output because one input is uncertain throws away real information.
- Blanks the comparison for eleven of twenty one sections when "better than the sector average" would have been both true and useful.

### Option 3: Change the claims, keep the arithmetic

Keep computing what is computed, and change what the product says about it: a range led headline, a shape aware peer comparison, declared assumptions the gate permits by name, per KPI source status, and the existing caveats carried through to the screen.

**Pros**:
- Each claim is brought down to what its evidence supports, rather than the output being discarded or the evidence overstated.
- Makes the launch gate meaningful again by separating "nobody has read this yet", which must reach zero, from "nobody publishes this", which is permitted and must be disclosed.
- The eleven degenerate sections keep a useful comparison, correctly described.
- The uncertainty was already computed. `costLowChf` and `costHighChf` have been on every snapshot since spec 0008 and are rendered today as muted small print under the headline. Leading with them is a presentation change, not new machinery.

**Cons**:
- A range is a weaker headline than a single number, and the disclosure gets longer and more hedged.
- Five new columns, a third snapshot schema version, two more `POSITIONS` values and a recompute.
- Does not improve the data. The values stay thin until curation, and two KPIs never get Swiss peer data at all.

### Option 4: Rekey the schema to the sources' own axes

Abandon NOGA sections for the Suva class scheme the accident data is actually published on, so no crosswalk is needed.

**Pros**:
- Removes the mapping uncertainty entirely for the accident rate, the one KPI with real coverage.
- Every stored row would be a native cut of a published table.

**Cons**:
- A company's NOGA code is what research extracts and what the client can confirm; nothing maps a company to a Suva premium class without the same unofficial crosswalk, so the uncertainty moves rather than disappearing.
- Breaks the BFS absence data, which is published by NOGA section and is the one source that matches the current schema natively.
- A far larger migration touching the company facts form, the catalogue, the section labels in both catalogs and every stored snapshot, for a benefit only one KPI sees.

## Rationale

Option 3 is chosen because the forces in Context are asymmetric in a way the other options miss. The formula is not in question and four of the five cost inputs are genuinely sourced from the UVG statistics and BFS tables. Exactly one input, the multiplier, has no published basis, and exactly one structural claim, the quartile distribution, outruns its data for half the sections. Option 1 clears flags without fixing either. Option 2 discards sound arithmetic because of one uncertain input. Option 4 relocates the mapping problem and breaks the source that currently fits.

The decisive evidence is that the uncertainty is already computed and already stored. `costLowChf` and `costHighChf` have ridden every snapshot since spec 0008, and spec 0008's own rationale lists "showing model uncertainty as a range and a confidence label rather than a point estimate" among the practices it rests on. The product computed the honest thing and then rendered it as muted small text beneath a confident headline. Leading with the range makes the presentation match a decision the project already made.

The project also has a recent, binding precedent. `docs/design.md` records the owner removing `HeroBenchmark` on 2026-09-10 because it showed "an example benchmark of a fictional Muster AG on invented figures", and names an invented screenshot as "the mistake `HeroBenchmark` was removed for". Telling a client in section R that they are in the "Top quarter" against p25, median and p75 of 157.2 is the same claim in a more consequential place, because it is presented as their own result rather than an illustration. Applying the standard the owner already set is not new policy.

On the bracket, the engineer chose to keep 2 to 5 and name both sources rather than re attributing to the EKAS range at identical values. That is the better call for a reason worth recording: the EKAS figure is genuinely Swiss but is published for slip and fall accidents specifically, so adopting it as a general workplace bracket would trade a weak citation for a misapplied one. Keeping the existing bounds and stating plainly that the upper one comes from a disputed 1931 study is more honest than borrowing Swiss authority for a number that does not carry it.

Deriving the point shape from the values rather than a CSV column follows the same instinct as the invariant elsewhere in this codebase: a marker that can disagree with the data it describes eventually will. The eleven existing rows classify correctly with no hand editing, and a future curator cannot mislabel one.

The engineer chose to keep a single franc figure in marketing while the app leads with a range. This is a real inconsistency and worth naming: the landing page will show one number where the dashboard shows a band. It is defensible because the marketing figure is an illustration of what the product computes rather than a claim about the reader's own company, and because the sentence already says "about" and links to the method. The marketing example test (AC-14) is what keeps that illustration tied to the model, which is the part that was actually broken: the homepage comment asserts the figure is "computed by the real model", but the value the visitor reads is a hand derived literal in both message catalogs with nothing tying it to the seed.

## Evidence: what the sources actually publish

Two read only research passes were run for this spec on 2026-09-11. Findings that shaped the decision, and the dead ends worth recording so the curation pass does not repeat them.

**On the indirect to direct cost ratio.** No Swiss or European body publishes one for general workplace accidents. The only genuine Swiss figure found is EKAS/CFST Mitteilungsblatt Nr. 95 (November 2022), which states indirect costs are "two to five times" the insured costs, but is scoped to slip and fall accidents and shows no underlying methodology. Two commonly invoked European figures are not this ratio at all: the ISSA "return on prevention" study's 2.2 is a benefit to cost ratio for prevention spending, not a cost decomposition, and using it as one would be a citation error; EU-OSHA's international cost comparison uses a DALY times GDP per employee model that does not decompose costs into direct and indirect. The ILO 2007 iceberg figure behind the current low bound could not be verified to a primary source in this pass and is flagged unconfirmed rather than disproven. The Heinrich 1:4 ratio behind the high bound is mainstream disputed: Manuele's ASSE papers and subsequent large sample work find the underlying 1931 data unreproducible.

**On statistical granularity.** The UVG-Statistik Table 1.2 rates are published by Suva premium class, around forty one classes with codes like `01B` and `22A`, sometimes grouped into about thirty presentational sectors. Suva states it orients class assignment toward the federal economic activity classification, but the classes are a risk tariffing scheme and no authoritative published crosswalk to NOGA was found; any section letter mapping is therefore approximate and lossy. BFS AVOL publishes the health related absence rate explicitly by Wirtschaftsabschnitt, which is the NOGA section letter, so that one series matches the current schema natively. BFS STATENT classifies establishments by NOGA and by size class (0 to 9, 10 to 49, 50 to 249, 250 plus since 2020), but that is the denominator side only. No Swiss source was found that cross tabulates accident or absence rates by company size band. Size band figures surfaced during the search that appear Swiss are German BG ETEM data and must not be used.

**On the seed as committed.** All twenty two peer rows are `size_band = 'all'`, correctly. Only `accident_rate_per_1000_fte` has any coverage. Eleven rows carry `p25 == median == p75`: sections A (128.9), B (97.0), D (44.3), E (105.5), L (33.2), O (44.3), P (38.4), R (157.2), S (38.8), T (24.2) and U (13.2). The `ALL` row takes its median from the published all industries rate and its quartiles from the spread across the fifty branch classes, which describes the spread of classes rather than of companies; the committed `source_note` says exactly that, and nothing renders it.

## References

**Project sources** (verifiable, in this repo):
- `AGENTS.md`: the benchmark rule (spec 0008 and 0010), the derived counts rule (spec 0012, `SNAPSHOT_SCHEMAS` keyed by literal versions), functional style, validate at the boundary, the service client rule.
- Spec 0008 (`docs/specs/0008-peer-benchmark-chf-opportunity/`): the three tables, the seed format and generator, the launch gate, the cost formula in AC-18, and its own rationale listing "showing model uncertainty as a range and a confidence label rather than a point estimate" among the practices it rests on.
- Spec 0012 (`docs/specs/0012-derived-injury-counts/`): the rule that a body change adds a `SNAPSHOT_SCHEMAS` key and never renames one, and the outstanding recompute note.
- `docs/design.md`: the `HeroBenchmark` removal of 2026-09-10 and the principle that a shown figure must not be invented.
- `docs/benchmark.md`: the source checklist recording what was read on 2026-09-06 and what was left uncovered.
- `supabase/seed-data/*.csv`: the committed values, their notes and their provisional flags.
- Installed skills: `supabase-postgres-best-practices`, `vitest`, `playwright-skill`, `next-intl-app-router`, `trigger-tasks`.

**Practices & standards**:
- Immutable, versioned records for derived figures people quote: append only snapshots with inputs copied in.
- Declaring a modelling assumption as an assumption rather than as data, so a gate can permit it by name.
- Deriving a classification from the data it describes rather than storing it beside them, so the two cannot disagree.
- Additive, backward compatible migrations while previews share a staging database.
- NOGA 2008, the Swiss version of NACE Rev. 2, for the division to section mapping.

**Links** (web verified 2026-09-11):
- EKAS/CFST Mitteilungsblatt Nr. 95, "Unfallursache Nr. 1" (2022), the two to five times statement: https://www.ekas.admin.ch/fileadmin/Dokumente/Mitteilungsblatt/MB_95_-_EKAS_Mitteilungsblatt_95_Unfallursache_Nr._1.pdf
- EU-OSHA, international comparison of the cost of work related accidents and illnesses, the DALY based model with no direct and indirect split: https://osha.europa.eu/sites/default/files/2021-11/international_comparison-of_costs_work_related_accidents.pdf
- ISSA, calculating the international return on prevention, the 2.2 benefit to cost ratio that is not a cost decomposition: https://www.issa.int/sites/default/files/documents/publications/2-ROP-FINAL_en-157255.pdf
- DGUV, prevention pays off, the English corroboration of that ratio's meaning: https://www.dguv.de/en/prevention/prev_pays_off/profitability/calculation_company/index.jsp
- SSUV/Suva, the UVG statistics class time series index showing the premium class structure: https://www.unfallstatistik.ch/d/neuza/suva_klasse_d.htm
- BFS, the health related absence rate by Wirtschaftsabschnitt: https://www.bfs.admin.ch/asset/de/36569173
- BFS STATENT, establishments and employment by NOGA and size class: https://www.bfs.admin.ch/bfs/de/home/statistiken/industrie-dienstleistungen/erhebungen/statent.html

## Amendment of 2026-09-12: why these four decisions

Recorded from the owner's brief of 12 Sep 2026 and the "Benchmark Repair Plan" artifact; the options weighed live there in full, this is the short form.

- **A peer reference of 0.** Options were to keep "no reference", to price it, or to price it with a reporting caveat. Pricing it was chosen: the rule in AC-18 of spec 0008 was aimed at a missing median, not at a legitimate zero, and a safest quarter with no incidents is exactly where the largest opportunity sits. The caveat option adds a sentence the data does not support (no Swiss source distinguishes reporting from safety at that level).
- **Single class sections.** Options were to keep the labelled comparison, to hide it, or to fall back to the all industry row. Keeping it was chosen: the point row machinery of this spec already renders it honestly, and an all industry fallback is comparable across clients but less specific than the client's own sector.
- **Fatalities.** Options were to convert at compare time, to add a `fatality_rate` KPI, or to show the sector rate as context only. Converting was chosen: one model rule and one stored field, no new `kpi_definitions` row, no new research target, and the client still gets a position. A new KPI would have been cleaner but would have doubled the surface for a KPI most companies report as 0.
- **Size bands.** Options were to scale the Suva row by the Eurostat band ratio, to store the Eurostat rows on a separate KPI, or to leave the bands empty. Scaling was chosen: it keeps one unit on the KPI so peer selection cannot pick a wrong unit row, it is size aware, and `basis` can say plainly that it is an estimate. Separate rows would have shown two rates for one thing.

Two things this amendment refuses, for the record: the ISSA "return on prevention" 2.2 as a multiplier (it is a return on investment, not a cost ratio) and the 25 to 50 thousand and 5 to 15 thousand franc injury bands from the two tier model (unsourced, and they price a recordable injury above a lost time one).
