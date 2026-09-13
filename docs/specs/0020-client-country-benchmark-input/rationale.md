# 0020. Client country as a benchmark input: rationale

The decision record behind [index.md](index.md). `/develop` reads the index; this file holds the why, the options, the evidence and the references.

## Context

The owner's market decision of 13 Sep 2026 made Switzerland the first country rather than the product: regulated companies in Europe, Switzerland first, a wider region later. The benchmark is where that shows first, because it is the free half of the promise and it is Swiss in three separate places. The lookup action writes the constant `CH` into `companies.country` (spec 0007 sourced it as "constant `CH`, only Swiss companies in scope"). The peer table `benchmarks` and the seven rows of `benchmark_assumptions` have no country column at all, so the task's peer query and the `ALL` rung of spec 0008 would hand a German company the Swiss sector spread without anyone noticing. And the currency is baked in three times: two assumption keys end in `_chf`, five snapshot scalar columns end in `_chf`, and every money string on the card and in the `benchmark_ready` email goes through the `chfWhole` named format.

Two things make this cheaper than it looks. The industry code already carries across: NOGA 2008, WZ 2008 and ÖNACE are national elaborations of NACE Rev. 2 and share the two digit division and the section letter, so `sectionOfDivision` needs no crosswalk. And the 12 Sep 2026 refresh (spec 0016 amendment) already reads three Eurostat ESAW tables by NACE section for Switzerland through the Eurostat API; the same three datasets exist for every EU member and the EFTA countries, only the `geo` filter changes. What does not carry across is the headline accident rate: Suva's rate per 1 000 full time equivalents is a Swiss unit and a Swiss reporting regime. Germany's DGUV publishes the same shape (reportable accidents per 1 000 Vollarbeiter by Wirtschaftszweig) under a different reporting threshold (more than three days of incapacity), and spec 0016 already forbids a raw Eurostat rate on that KPI because peer selection would silently pick a row in the wrong unit.

The forces: every existing Swiss snapshot must render unchanged (the owner has clients on it); previews share staging, so the migration must be add, switch, remove; the launch gate must stay two honest queries and now also say which countries are covered; the peer honesty rules of spec 0016 (a point row never says median, a provisional row never ships, a declared assumption is named) apply to every country; and rows 30 and 31 read whatever this spec decides about codes and currencies, so the contract has to be written down once. Not deciding means the first German pilot is priced in CHF against a Swiss bar, which is exactly the "modelled estimate presented as measured" failure spec 0016 was written to stop.

**Compliance scope**: none new. A country is a company fact, not personal data; the research prompt payload rule of spec 0007 AC-13 holds.

## Options considered

### Option 1: Keep Switzerland as the fallback, add countries on top

Add `country` to the peer and assumption tables and let the rung ladder fall through to the Swiss rows (or to an `ALL` country) when the company's country has none. A German company gets German rows where they exist and Swiss rows elsewhere, so the card is never empty.

**Pros**:
- No empty cards on day one; every KPI with any row shows a position.
- The smallest change to the model: one more rung.

**Cons**:
- It is the exact failure the scope forbids: a German client measured against a Swiss bar under a different reporting regime, with the Swiss label buried in `basis`.
- The currency cannot fall back: a Swiss cost per case in CHF applied to a German company is wrong in unit and in regime, so the cost model would still need a hard stop, and the ladder would have two different fallback rules.
- Every later country inherits the ambiguity; the gate cannot say what "covered" means.

### Option 2: Country on every row, one country per snapshot, no fallback across countries (chosen)

`companies.country` is set by the client at lookup and corrected on the facts card. `benchmarks` and `benchmark_assumptions` gain a `country` column; the task loads only the company's country plus the unitless multipliers on `ALL`; the model resolves an assumption by `(key, country)` then `(key, 'ALL')` and otherwise records a skipped cost with the key named. The snapshot stores `country` and `currency` as scalars, old rows read the defaults `CH` and `CHF`, and every money string is formatted with the snapshot's currency at call time. A country with no rows says "no national figure yet".

**Pros**:
- The honesty rule is structural: a Swiss row cannot reach a German snapshot because the task never loads it, and a test proves it.
- Old Swiss rows need no rewrite and no recompute; the reader normalises them through two column defaults.
- Adding a country is data plus a gate run; the code path is the same for every country.
- One catalogue in code gives rows 30 and 31 their codes and currencies without a second list.

**Cons**:
- Empty cards for uncovered KPIs and uncovered countries, by design, until the seed and row 30 fill them.
- The assumption table grows by four rows per country and the multipliers need the `ALL` convention, which the seed schema and pgTAP must police.
- Two money keys and five snapshot columns keep a misleading `_chf` name for a while (add, switch, remove).

### Option 3: A `countries` table with a foreign key from every row, and per country model versions

Model countries as a table (`code`, `currency`, `name_de`, `name_en`, `covered`), reference it from `companies`, `benchmarks`, `benchmark_assumptions` and `benchmark_snapshots`, and let each country carry its own model version so a country specific rule (a different reporting threshold, a different cost formula) can be expressed.

**Pros**:
- Referential integrity on the code; coverage is a column ops can flip.
- Room for a per country formula later.

**Cons**:
- Nothing joins the table: names come free from `Intl.DisplayNames`, the currency is a fact of the code, and coverage is better derived from the rows that exist than from a flag that can drift.
- Per country model versions make `SNAPSHOT_SCHEMAS` two dimensional and break the one map rule of spec 0012; no country needs a different formula today, only different inputs.
- More migration surface for the same outcome.

### Option 4: Country from the research, corrected by the client

Let the research provider extract the headquarters country and write it, with the client correcting it on the facts card, so the lookup form stays one field.

**Pros**:
- One field fewer on the lookup form.

**Cons**:
- The provider already receives the country as an input (spec 0007 AC-13) to steer the research; it cannot both consume and produce it.
- A research overwrite would silently move a company's peer table and currency after the client had already seen a benchmark.
- The column is `not null default 'CH'`, so "fill where null" never fires; the research would have to overwrite a default it cannot distinguish from a choice.

## Rationale

Option 2 is chosen because the scope's own "done when" is a structural statement: a German company compares against Germany's rows, prices in EUR with German assumptions, and a country without a table never shows a Swiss value. Option 1 satisfies the first two and violates the third by design; Option 2 makes the third a property of the task's query rather than a UI rule, which is what spec 0016 did for point rows and what has held. The empty cards it produces are the same honest state the Swiss card already shows for LTIFR and TRIFR, and row 30 exists precisely to fill those rows with named peers.

The client sets the country (against Option 4) because the research needs the country as an input and because a country change moves both the peer table and the currency, which is a decision a client must make knowingly on the facts card and see recomputed, not one a background job makes for them. The lookup form's default stays `CH` because the marketing site is Swiss first; the grouped select (covered countries first) tells a German visitor what they will get before they pick.

The `_chf` suffix leaves the assumption keys because a key named `direct_cost_per_case_chf` holding a EUR value is a trap every later reader falls into; the seed is the cheap place to rename, and the add, switch, remove sequence keeps previews working. The five snapshot scalar columns are not renamed now: a column rename on a live tenant table with shared staging is the expensive kind of change, `currency` beside them removes the ambiguity for the reader, and row 31 will touch money columns anyway. The multipliers live once on `ALL` (rather than copied per country) because they are unitless declared assumptions with one note; copying them would make gate two's "exactly these three" grow by three per country for no information. Money keys are forbidden on `ALL` so the `ALL` rung can never carry a currency.

Germany is the second country because it is the largest market the owner named, DACH shares the language pair the product already ships, DGUV publishes the accident rate in the same shape as Suva (the fact check confirmed the table by Wirtschaftszweig), and the three Eurostat tables cover `DE`. Austria was the runner up and moves to Follow-up only because the fact check could not confirm AUVA's table by ÖNACE. A European aggregate rung was considered and left out: it is a labelled fallback, but it is still a fallback, and the scope asked for none.

The German cost assumptions are the weakest part, as the Swiss ones were on 6 Sep 2026. The rule is the one the runbook already states: no invented value; where a published German figure exists, read it and keep it `provisional` until read; where none exists, declare the assumption with its derivation and name it in the gate's expected list. The alternative, blocking Germany until every figure has a national source, would keep the positions off the card too, which helps nobody; with the stored skipped cost of AC-8 the positions render and the cost card says the model is not there yet.

`Intl.DisplayNames` over message keys because both languages get every European country name from the runtime with no catalog growth; the two catalogs are already 337 kB.

## The country catalogue

The 32 codes `COUNTRIES` holds, with the currency each maps to. Bulgaria adopted the euro on 1 January 2026, so `BG` is `EUR`. Liechtenstein uses the Swiss franc.

| Code | Currency | Code | Currency | Code | Currency | Code | Currency |
|---|---|---|---|---|---|---|---|
| AT | EUR | BE | EUR | BG | EUR | HR | EUR |
| CY | EUR | CZ | CZK | DK | DKK | EE | EUR |
| FI | EUR | FR | EUR | DE | EUR | GR | EUR |
| HU | HUF | IE | EUR | IT | EUR | LV | EUR |
| LT | EUR | LU | EUR | MT | EUR | NL | EUR |
| PL | PLN | PT | EUR | RO | RON | SK | EUR |
| SI | EUR | ES | EUR | SE | SEK | CH | CHF |
| LI | CHF | NO | NOK | IS | ISK | GB | GBP |

Row 30 adds a `region` per code here (its ladder rungs); row 31 adds nothing here and keeps VAT treatment in its own module keyed by the same code.

## The per country seed plan

What each country needs, and where Germany's rows come from. A first row is `provisional` until read, as the runbook requires; a value with no published source is a declared assumption with its derivation in `note`.

| Row | Switzerland (exists) | Germany (this feature) | Any later country |
|---|---|---|---|
| `accident_rate_per_1000_fte` per section | UVG-Statistik Table 1.2, BUV column | DGUV "Meldepflichtige Arbeitsunfälle je 1.000 Vollarbeiter nach Wirtschaftszweigen" (dguv.de, latest edition, 2023 figures at the time of the fact check); `basis` states the more than three days threshold; `source_key` names the DGUV branch | the national insurer's rate per 1 000 full time workers, or the KPI stays uncovered (never a raw Eurostat rate on this KPI, spec 0016 D4) |
| `accident_rate_per_1000_fte` per band | Suva row × Eurostat `hsw_n2_05` ratio, floor 100 accidents and 5 000 persons | DGUV row × `hsw_n2_05` `DE` ratio, same floor and fold, ratio table shown to the owner | the same rule, through the recorded Eurostat requests (a script is a Follow-up) |
| `fatalities` per section | Eurostat `hsw_n2_02`, `RT_INC` | `hsw_n2_02`, `geo=DE` | `hsw_n2_02` |
| `lost_days_per_incident` per section | Eurostat `hsw_n2_04`, interpolated median | `hsw_n2_04`, `geo=DE`, same interpolation | `hsw_n2_04` |
| `absenteeism_rate` | BFS AVOL table | uncovered (Destatis publishes no health absence rate by section in the BFS shape; leave uncovered rather than substitute the sick leave ratio of the health insurers) | uncovered unless a national table matches the BFS definition |
| `ltifr`, `trifr`, `iso_45001_certified`, `near_miss_rate` | uncovered (spec 0016) | uncovered; row 30 fills LTIFR and TRIFR with named peers | same |
| `hours_per_fte` | BFS annual hours of full time employees | Destatis or Eurostat annual hours actually worked per full time employee, latest year; the row names the table | the national statistics office, else Eurostat |
| `direct_cost_per_case` | UVG-Statistik tables 6.4 and 6.5, weighted mean | derived from the DGUV Jahrbuch: the accident insurers' expenditure on occupational accidents over the reportable accidents of the same year, the derivation in `note`; `is_assumption` if the expenditure line is not published per accident kind | a derivation from the national insurer's accounts, declared as such |
| `cost_per_absence_day` | SWICA calculation on BFS data | BAuA "Sicherheit und Gesundheit bei der Arbeit" (SuGA), production loss per day of incapacity, latest report; if the per day figure is not published, the labour cost derivation (Eurostat hourly labour cost `lc_lci_lev` for `DE` × the daily hours from `hours_per_fte`) flagged `is_assumption` with the derivation in `note`, and the runbook's gate two list names it | the same two step rule |
| `lost_days_per_incident_default` | derived from the daily allowance | the DGUV mean days of incapacity per reportable accident where published, else the `lost_days_per_incident` `ALL` row for `DE` from `hsw_n2_04`, declared as a derivation | the same |
| multipliers | `ALL`, once | `ALL`, once (no per country copy) | `ALL`, once |

Reporting regime caveat, on every German `basis`: Germany counts reportable accidents (more than three days of incapacity), Switzerland counts every registered case; EUROGIP's 2023 under reporting study shows the regimes differ across Europe. The product never compares a German card with a Swiss card, and the `basis` sentence is what makes that visible to a reader who does.

## Fact check of 13 Sep 2026

Run once by a read only researcher during this spec; the links below are the ones it confirmed. Nothing here is fetched again by a later step.

- Eurostat ESAW: `hsw_n2_01` holds non fatal accidents by NACE Rev. 2 activity with an incidence rate unit (`RT_INC`, per 100 000 employed persons); `hsw_n2_02` holds the fatal accidents by NACE with the rate unit the CH seed already uses. Coverage is the EU members plus Iceland, Norway and Switzerland; the latest reference year is 2023. `hsw_n2_04` and `hsw_n2_05` were not found in the metadata page the researcher read, but both were read for Switzerland on 12 Sep 2026 through the API (spec 0016 amendment), so they exist; the recorded requests in the runbook are the recipe for every later country.
- The Eurostat statistics API takes `geo` and `nace_r2` filters on the dataset path (`…/statistics/1.0/data/<code>?lang=EN&geo=DE&nace_r2=<section>`); the exact filter spelling per dataset is the one recorded in the runbook from the CH and DE reads.
- DGUV publishes "meldepflichtige Arbeitsunfälle je 1.000 Vollarbeiter" by Wirtschaftszweig on its statistics pages (2023 figures at the time of the check). The mean cost per accident and a per day cost of incapacity were not confirmed; the seed plan names the derivations.
- AUVA statistics by ÖNACE were not confirmed; only an aggregate frequency rate surfaced. Austria is a Follow-up.
- Comparability: Germany's threshold is more than three days of incapacity; Switzerland's Suva reports near complete registration and one of Europe's highest raw rates for that reason (EKAS/ZHAW 2025, EUROGIP 2023). Standardised Eurostat rates exclude some sections, which is another reason the national rate stays the national insurer's and never Eurostat's.

## References

**Project sources** (verifiable, in this repo):
- Root `AGENTS.md`: the four things the migration diff misses, backward compatible migrations because previews share staging, the tenant table contract.
- `src/features/benchmark/AGENTS.md` and `docs/benchmark.md`: the model, the snapshot map, the seed generator, the two flags, the gate queries, the confirmed dead ends.
- Spec 0007 (AC-13, the provider input carries `country`; the value sourcing row "constant `CH`").
- Spec 0008 (the rung ladder, the snapshot blocks, `roundChf`, the `benchmark_ready` payload).
- Spec 0012 (the literal version map in `SNAPSHOT_SCHEMAS`, no formula change without a bump).
- Spec 0016 and its 12 Sep 2026 amendment (D3 fatality rate at compare time, D4 size bands as a scaled national row, never a raw Eurostat rate on the accident rate KPI, the launch gate as two queries).
- Spec 0011 (`billing_country` as ISO 3166-1 alpha 2, `currency` constrained to `CHF` and "widened by a later migration": row 31's hook).
- The Peer Standing design page (artifact `3ef5da7c-9080-44f9-8405-b49b75a2cbc5`, indexed in the local `docs/artifacts/README.md`): the ladder rungs, the country on every peer row, money only on the client's own row.
- Installed skills: `supabase-postgres-best-practices`, `supabase`, `trigger-tasks`, `next-intl-app-router`, `react-email`, `vitest`, `playwright-skill`.

**Practices & standards**:
- ISO 3166-1 alpha 2 country codes and ISO 4217 currency codes as the only identifiers.
- NACE Rev. 2 as the shared industry classification (NOGA 2008, WZ 2008 and ÖNACE 2008 are national elaborations with the same two digit divisions).
- Add, switch, remove for schema changes on a shared database.
- Versioned immutable snapshots; old rows are never rewritten.
- `Intl.DisplayNames` for localised region names.

**Links** (web verified by the fact check of 13 Sep 2026):
- Eurostat, accidents at work (ESAW) metadata: https://ec.europa.eu/eurostat/cache/metadata/en/hsw_acc_work_esms.htm
- Eurostat, statistics API guidelines: https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-detailed-guidelines/api-statistics
- Eurostat, accidents at work by economic activity (statistics explained): https://ec.europa.eu/eurostat/statistics-explained/index.php?title=Accidents_at_work_-_statistics_by_economic_activity
- DGUV, meldepflichtige Arbeitsunfälle je 1.000 Vollarbeiter: https://www.dguv.de/de/zahlen-fakten/au-wu-geschehen/au-1000-vollarbeiter/index.jsp
- EUROGIP, under reporting of accidents at work in Europe (2023): https://eurogip.fr/wp-content/uploads/2024/08/EUROGIP-2023-Under-reporting-of-accidents-at-work-in-Europe.pdf

## Cross check of 13 Sep 2026

A read only pass on a different model reviewed the draft. Its load bearing findings, all folded into the index: renaming the assumption keys reaches into the `@1` to `@4` snapshot schemas through `z.enum(ASSUMPTION_KEYS)`, so the old keys must stay readable for good (`LEGACY_ASSUMPTION_KEYS`) or every Swiss card goes blank; the email payload rename needed the same add, switch, remove treatment as the database; the seed generator has no assumption retirement today, so it is new work; the facts form's `nothingToSave` refine had to give way to a compare with the stored row; the skipped cost literal is `missing_assumption` in the code; the message keys, the `coveredCountries` plumbing and the two facts form renderers were unstated; and a country change on a Swiss company must keep the old card's own country label until the new snapshot lands. It also argued the Eurostat script was a whole build step for two hand reads per country; the script moved to Follow-up and Germany is read by hand as Switzerland was.
