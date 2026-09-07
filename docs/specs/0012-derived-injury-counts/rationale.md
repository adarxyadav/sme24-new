# 0012 rationale. Derived injury counts as a display only snapshot block, not new KPI rows

The decision, requirements and build plan are in [index.md](index.md). This file holds the history: why the question came up, what else was considered and why the chosen option won.

## Context

> ⚠️ Premise note: the question as posed ("two new `kpi_definitions` rows or a display only block") frames this as a catalogue decision, but the deciding force is not where the numbers are stored, it is what they are. A KPI in this product is a measured quantity that gets compared against a peer distribution and can carry a CHF saving when it sits below the median. A derived count is neither measured nor comparable: `seed-data/*.csv` holds no peer percentiles for injury counts, and it never can hold useful ones, because a count is a function of company size while a rate is not. Making the counts KPI rows would put two permanently empty peer columns in the KPI table and two entries in the priority gap ranking that can never rank. The right framing is that these are an explanation of the cost model, not an input to it, and the spec is written that way.

The peer benchmark (spec 0008) turns stored KPI rows into a snapshot: peer positions per KPI, a ranked list of priority gaps, and an annual incident cost in CHF with a low and high band. The cost line already computes a count internally. `costAt` in `src/features/benchmark/model.ts` derives `incidents` as `rate x fte / 1000` for the Suva accident rate, or `rate x fte x hours_per_fte / 1_000_000` for LTIFR, then multiplies by a cost per case. That count reaches the snapshot as `SnapshotCost.incidents` and is never shown.

The result is a gap in the client's reasoning. The opportunity card shows a CHF figure that came from a rate the client may not intuitively understand, and the only explanation is the calculation disclosure, which is collapsed by default and written for someone who already wants the arithmetic. A pilot client asking "why is this number CHF 84,000?" has to open the disclosure and follow a rate through an exposure calculation. A count in whole injuries is the step most people reason in.

Two constraints shape any answer. First, provenance is already load bearing in this product. Feature 8 attaches a confidence score and source excerpts to every researched value; feature 10 added the "Your figure" badge so a client can see which numbers they overrode. A third kind of number that looks like the other two would undo that work, and a calculated number is the most dangerous kind to blur, because it inherits its trustworthiness from an input the reader cannot see. Second, `benchmark_snapshots` rows are immutable and versioned. `SNAPSHOT_SCHEMAS` in `snapshot.ts` is keyed by `MODEL_VERSION`, and `AGENTS.md` records the rule that a formula change bumps the version and adds a schema rather than rewriting stored rows. Anything added to a snapshot has to leave existing rows readable.

Not deciding leaves the counts where they are today: computed on every benchmark run, stored in the snapshot as `cost.incidents`, and shown to nobody.

## Options considered

### Option 1: Two new `kpi_definitions` rows

Seed `recordable_injuries` and `lost_time_injuries` into the KPI catalogue, add them to `KPI_KEYS`, and have `benchmark-company` write `company_kpis` rows with a new `source` value of `derived`. They then flow through the existing KPI table, the peer comparison and the ranking for free.

**Pros**:
- One code path for every number the client sees; the existing badge switch, table and confidence machinery all apply with no new components.
- A future decision to peer compare counts, or to let a client enter a raw count, needs no restructuring.

**Cons**:
- No peer data exists for counts and none is coming: the seed CSVs hold percentiles per industry section and size band, and a count is already a function of size, so the two dimensions collide. Both rows would show a permanently empty peer column and sit unrankable in the priority gaps.
- Widening the `company_kpis.source` check constraint means a third writer class with its own RLS story: service role writes, client cannot edit, client cannot clear. That is three policy changes and a pgTAP rewrite on a tenant table, far heavier than the one nullable column Option 2 needs, for a value that is a pure function of two other rows.
- Storing a derived value denormalizes it. A client edits their headcount, and until `benchmark-company` finishes, the stored count contradicts the rate it came from.
- `KPI_KEYS` is `z.enum`ed throughout `snapshot.ts`, so this bumps `MODEL_VERSION` anyway, on top of the heavier migration.

### Option 2: A `derived` block in the snapshot (chosen)

`computeBenchmark` returns a sixth block alongside `inputs`, `results`, `gaps`, `cost` and `assumptions`, stored in a new nullable `derived jsonb` column on `benchmark_snapshots`. It holds the two counts, each nullable, each with the key, source and reporting year of the rate it came from. `MODEL_VERSION` goes to `benchmark-model@2` and `SNAPSHOT_SCHEMAS` gains a second literal key so both versions stay readable. The dashboard renders it inside the opportunity card with a "Calculated" badge.

**Pros**:
- The migration is one nullable column on a table only the service role writes: no policy change, no widened constraint, no new writer class, and nothing to backfill.
- No client facing value gains a third kind of source, so the `company_kpis` contract from spec 0002 and the client edit rules from spec 0010 are untouched.
- Immutability is preserved correctly. The counts are frozen with the inputs that produced them, so an old snapshot always reads as an internally consistent statement.
- The counts cannot drift from the cost line, because both come from the same exposure helper.
- Honest about what these are: an explanation of the cost model, sitting where the cost model already lives.

**Cons**:
- A migration after all, plus a pgTAP touch, so this is not the free option it first appears to be.
- A `MODEL_VERSION` bump and a second entry in `SNAPSHOT_SCHEMAS`, which is a permanent maintenance cost on the reader (two schemas to keep valid instead of one), and it forces a restructure of that map from its current single self referential key.
- Several call sites are coupled to the version by name: the task parses against `snapshotBlocksV1Schema` directly, and four tests pin the literal `"benchmark-model@1"`. Each has to move deliberately.
- The counts are invisible to anything reading `company_kpis`, so a future export, an expert view, or a gap report wanting them has to read the snapshot instead.
- A new badge and a new block are net new UI rather than reuse of the KPI table.

### Option 3: Recompute in the UI from `inputs`

Store nothing. The benchmark segment reads `inputs.kpis` and `inputs.fte` and derives both counts at render time.

**Pros**:
- Smallest possible change: no schema, no version bump, no migration, no recompute run.
- Every existing snapshot shows the counts immediately.

**Cons**:
- Puts the formula in two places. `costAt` keeps its copy for the CHF line and the UI grows a second, and they will drift the first time the exposure rule changes.
- Silently rewrites history. Bumping the exposure assumption changes what an old snapshot appears to say, which is exactly what the versioned snapshot design exists to prevent.
- The `hours_per_fte` assumption would have to be read and applied in a presentation component, moving model arithmetic out of the pure model and breaking the rule that `computeBenchmark` is the one place the numbers are made.

## Rationale

The deciding force is the one named in the premise note: a count is not comparable against the peer data this product has or can get. `benchmark_peers` is keyed by industry section, size band and year, and holds `p25`, `median` and `p75` of a rate. A count already carries company size inside it, so comparing one company's count against a size banded distribution of counts would be comparing two different things and would produce a position and a gap that mean nothing. Everything the KPI path gives for free (the peer column, the position, the rank, the CHF saving) is exactly what these two numbers must not have.

Both options cost a migration, so the choice is not free versus not free, it is which migration. Option 1 widens a check constraint on `company_kpis`, a tenant table with six policies and a pgTAP suite, and introduces a third writer class whose read, edit and clear rules all have to be reasoned about against the client edit path spec 0010 just settled. Option 2 adds one nullable column to a table only the service role writes, with nothing to backfill and no policy to touch. Paying the heavier of the two to join a pipeline whose benefits do not apply is the wrong trade.

Provenance settles the marking question the same way. The product already distinguishes two kinds of number and has trained the client to read that distinction. A calculated value is the one kind whose reliability is not its own: a count derived from a low confidence researched LTIFR is exactly as shaky as that LTIFR, and no more. Showing an inherited confidence badge would imply the derivation was independently assessed; showing no provenance at all would let a shaky number borrow the authority of the card it sits in. Naming the input figure and its year, with no confidence score, is the honest middle: the reader is pointed at the number they should actually be judging.

Option 3 is tempting on cost and was rejected on one specific failure. `MODEL_VERSION` exists so that a stored snapshot means today what it meant when it was written. A count computed at render time from a live `hours_per_fte` would change meaning under an old snapshot the day that assumption is revised, which is the drift the versioned schema map was built to stop. The version bump Option 2 pays for is the mechanism working, not overhead.

One narrower variant deserves an answer, because it looks like free simplification: read the lost time count straight from the existing `cost.incidents` and store only the recordable count. It was rejected on two counts. `cost` is null whenever there is no incident rate or no FTE, but the derived block must still stand when only TRIFR and a headcount exist, so the lost time count cannot depend on the cost block existing. And `cost.incidentKpi` is chosen by the cost model's own precedence (the Suva rate before LTIFR), which need not be the rate the derived block should name to the reader. The apparent duplication of `count`, `fte` and `hoursPerFte` is what keeps the derived block a self contained statement, and AC-9 plus its test are what keep it honest.

## References

**Project sources**:
- `AGENTS.md`, the benchmark rule: a formula change bumps `MODEL_VERSION` and adds a schema to `SNAPSHOT_SCHEMAS`, never rewrites old rows.
- `AGENTS.md`, the KPI rule: a new KPI is a `kpi_definitions` seed row plus a `src/features/research/catalogue.ts` entry, kept equal by a Vitest test. This spec deliberately does not trigger it.
- Spec [0008](../0008-peer-benchmark-chf-opportunity/index.md): the cost model, `costAt`, the assumption disclosure and the immutable snapshot design.
- Spec [0007](../0007-company-research-pipeline/index.md): the KPI catalogue, confidence scores and source excerpts.
- Spec [0010](../0010-self-assessment-fallback/index.md): the client value path and the "Your figure" badge this decision sits beside.
- Spec [0002](../0002-data-model/index.md): the `company_kpis` tenant table contract and its `source` constraint.
- `docs/design.md`: the badge inventory and the `/admin/design` gallery requirement.

**Practices & standards**:
- Versioned, immutable read models: a stored computation names the schema it was written under, so an old row means today what it meant when written.
- Single source of truth for a formula: one named pure function, called by every consumer, rather than a duplicated expression.
- Provenance in derived data: a derived value names its input and does not inherit its input's confidence assessment.
- Suva "Unfälle pro 1000 Vollbeschäftigte", the Swiss accident rate convention already encoded in `src/features/research/catalogue.ts`, which is why the fallback path exists.
