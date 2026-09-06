# 0010. Self assessment fallback: rationale

The decision record behind [index.md](index.md). `/develop` does not need this file.

## Context

Feature 8 stores every safety KPI the research pipeline finds as a `company_kpis` row with `source = 'research'`, one per company, KPI and reporting year, and feature 9 turns the highest year per KPI into a peer position and a CHF estimate. Three things break that promise for a real client: the pipeline finds nothing (a private company with no published safety report), it finds a wrong number (a group figure applied to a Swiss subsidiary, a rate in the wrong unit), or it finds the right numbers for a year the client no longer cares about. The scope's feature 10 answers all three with one idea: the client types the same eight KPIs by hand and the benchmark recomputes.

The data model was designed for this in spec 0002 and 0007: `company_kpis.source` already allows `client`, the members insert, update and delete policies for client rows exist, a partial unique index keeps one client row per company, KPI and year, and the `company_kpi_current` view prefers a client row over a research row for the same year. The benchmark task already treats a client row as confidence 1 and already prints the source kind in the disclosure. So the feature is not a data question. It is three product questions the build could not settle on its own: which reporting year a hand entered value belongs to, what a client "clearing" a value should mean for the research value underneath, and where on an already long dashboard the form lives so both flows (fill everything, fix one number) work.

Two forces shape the answers. The benchmark uses the newest year per KPI, so the year a client picks decides whether their figure drives the benchmark at all. And every guard the client relies on (tenant isolation, one row per year, the audit trail) is in the database; anything the app adds on top must not need a second copy of those rules.

## Options considered

### Option 1: One card, one year, plain rows (chosen)

A "Your figures" card under the KPI table with a single year picker for the whole form, eight fields prefilled from the current rows, save writes ordinary client rows, clear deletes the row, every write queues the existing benchmark task.

**Pros**:
- No schema change; the view and the policies do the fallback and the isolation.
- One place serves both flows: fill everything after an empty run, or fix one number in place.
- Clearing needs no new state anywhere; the research value returns by the view's ordering.

**Cons**:
- Eight fields make the dashboard longer for a client whose research was complete.
- The save is several statements (the partial unique index blocks a PostgREST upsert), so it is not atomic.
- A client cannot dismiss a research value without replacing it.

### Option 2: Per row editing in the KPI table

A pencil per KPI row opens a small dialog with a year and a value; each dialog saves one row.

**Pros**:
- Best for a single correction: the edit sits next to the number it replaces.
- Each save is one row, so the write is trivially atomic.

**Cons**:
- Eight dialogs when the pipeline found nothing, the main reason the feature exists.
- The table renders only when a run finished; a failed run has no table to edit, so a second entry point is needed anyway.
- Eight year fields invite mixed years by accident.

### Option 3: A dedicated page under `/app`

A button on the dashboard opens `/app/kpis`, a page with room to explain each KPI, its unit and what counts.

**Pros**:
- Keeps the dashboard short and gives space for guidance per KPI.
- Natural home for later additions (notes, source links, uploads).

**Cons**:
- A new route, layout, navigation entry and return trip for what is usually a one minute task.
- The client loses sight of the table and the benchmark they are correcting.

### Option 4 (for clearing only): keep the row and mark it cleared

A `cleared_at` column or a nullable `value` so the history of what the client entered stays visible, plus a view and a benchmark rule for cleared rows.

**Pros**:
- The history is visible without reading the audit log.

**Cons**:
- A migration, a view change, a benchmark rule and a table state for a case the audit trigger already records.
- Every reader must learn a third kind of row.

### Option 5 (for the write path only): a SQL function for the save

`public.save_client_kpis(company_id, period_year, values jsonb)` as a security invoker function with one `insert … on conflict (company_id, kpi_key, period_year) where source = 'client' do update`.

**Pros**:
- One statement, atomic across the eight KPIs, RLS still applies.

**Cons**:
- A migration with the hand re added `anon` execute revoke, a pgTAP file and a types regeneration for a form.
- Moves validation logic for a UI feature into the database.

### Option 6 (for the write path only): delete then insert

The action deletes the client rows for (company, year, the sent keys) and inserts the sent values in one multi row statement.

**Pros**:
- One fewer round trip and no `23505` branch in the common case; every written row shares one `updated_at` cohort for the idempotency key.

**Cons**:
- A corrected value gets a new row id and a delete plus insert in the audit log instead of one update.
- A row created by another member is not deleted (zero rows through the policy) and the insert then fails on the unique index, so the `forbidden` case still needs its own branch.

## Rationale

The chosen option is the smallest thing that satisfies the scope's "done when" (enter or edit each KPI with validation, the benchmark updates, the dashboard shows the source) with no new state. The forces from Context settle the three questions. The year is chosen once for the whole form and defaults to the newest year on file because the benchmark takes the newest year per KPI: a correction then lands on exactly the row the benchmark reads, and a fresh entry after an empty run defaults to the previous calendar year, the year a Swiss safety report covers. A year field per KPI would let a client mix years by accident, and a fixed year would make an older research value impossible to correct. Because an older year is still a legitimate choice, the form says out loud when the benchmark will keep a newer value instead of hiding it.

Clearing is a delete because the view already resolves "what is current" by preferring the client row and then the newest research row; deleting the client row restores the research value with zero new logic, and the audit trigger keeps the history. A "cleared" state would add a migration and a third row kind to every reader for a case the database already records. Dismissing a research value is a different product question and is left as a follow up.

The form lives in one card under the KPI table because the two flows the scope names (fill everything, fix one number) both need all eight fields in view with their current values, and because the card must also render when a failed run leaves no table. Per row editing serves the correction flow well and the empty flow badly; a dedicated page serves guidance well and the correction flow badly. The card's cost, a longer dashboard, is accepted for a Beta tier feature and can be revisited with feature 23's shell work.

On the write path: the client unique index is partial (`where source = 'client'`), and PostgREST's upsert emits `on conflict (columns)` without the predicate, which Postgres rejects. A SQL function would restore atomicity at the price of a migration; a read then write in the action keeps the feature schema free, and the failure mode (some values saved, the refresh shows them, a retry saves the rest) is benign. Delete then insert (Option 6) saves one round trip but turns every correction into a new row and still needs the `forbidden` branch; read then write keeps row ids stable and the audit log honest, which matters more than one statement. The trade is recorded in Consequences so a later feature with a stricter need can pick the function.

The remaining calls were made with the same rule, reuse before adding: the `client_edit` trigger kind and the 1 hour idempotency window come from spec 0008 unchanged; the idempotency keys use a value that changes with every real write (`updated_at` of the written rows, the id of the deleted row) so two saves in one second collapse into one computation while a save and a clear never do; the form copies the facts form pattern so a second success line, error map and refresh path do not appear; the badge replaces the confidence badge because a client row has no confidence to show and two badges in one cell would read as a contradiction.
