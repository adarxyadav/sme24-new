-- Research peers (spec 0022, kind T): the published safety figures of one peer company, found by
-- the `research-peers` task for one research run and stored as that run wrote them. One row per
-- run, peer and KPI, so a peer that published both LTIFR and TRIFR takes two rows.
--
-- The rows belong to the run, not to a library: a rerun writes a new run's rows beside the old
-- ones and the benchmark reads the rows of the run it was triggered for (AC-17). `value` is always
-- per million hours worked, converted in code from `value_as_published` and `unit_as_published`
-- (AC-8), which are kept so the table can show the figure as the peer printed it. `rung` records
-- which ladder step the task settled on (AC-7) and is the same for every row of a run.
--
-- Written by the task through the service client alone; members of the organization read. Not in
-- the realtime publication: the client page learns about peers through the snapshot that follows.

create table public.research_peers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  research_run_id uuid not null references public.research_runs (id) on delete cascade,
  peer_name text not null check (char_length(peer_name) between 1 and 200),
  peer_website text null,
  -- ISO 3166 alpha 2, the same catalogue companies.country uses (src/lib/countries.ts).
  peer_country text not null check (peer_country ~ '^[A-Z]{2}$'),
  -- A NOGA/NACE section letter A to U; the client company's own section at the time of the run.
  industry_section text not null check (industry_section ~ '^[A-U]$'),
  headcount integer null check (headcount > 0),
  headcount_year integer null check (headcount_year between 2000 and 2100),
  kpi_key text not null references public.kpi_definitions (key)
    check (kpi_key in ('ltifr', 'trifr')),
  period_year integer not null check (period_year between 2000 and 2100),
  value numeric not null check (value >= 0),
  value_as_published numeric not null check (value_as_published >= 0),
  unit_as_published text not null
    check (unit_as_published in ('per_million_hours', 'per_200k_hours', 'per_100_workers')),
  basis text null check (basis in ('employees', 'employees_and_contractors')),
  source_url text not null check (char_length(source_url) between 1 and 2000),
  source_title text null,
  confidence numeric not null check (confidence between 0 and 1),
  rung text not null check (rung in ('country', 'region', 'world')),
  created_at timestamptz not null default now()
);

comment on table public.research_peers is 'The published LTIFR and TRIFR of the peers one research run found (spec 0022); written by the research-peers task alone.';
comment on column public.research_peers.value is 'Per million hours worked, converted in code from value_as_published and unit_as_published (AC-8).';
comment on column public.research_peers.unit_as_published is 'The unit the peer printed; per_200k_hours and per_100_workers are both multiplied by five to reach value.';
comment on column public.research_peers.rung is 'Which ladder step the task settled on (AC-7): the same value on every row of a run.';
comment on column public.research_peers.confidence is 'The validator''s confidence in the figure (AC-8); capped at 0.5 when the validation call was skipped.';

-- One figure per run, peer and KPI: the task inserts its kept rows in one statement (AC-10) and a
-- retry of that insert must not double the table.
create unique index research_peers_run_peer_kpi_idx
  on public.research_peers (research_run_id, peer_name, kpi_key);
-- What the benchmark task reads: the rows of one company's one run (AC-17).
create index research_peers_company_run_idx on public.research_peers (company_id, research_run_id);
create index research_peers_organization_id_idx on public.research_peers (organization_id);

alter table public.research_peers enable row level security;

create policy "research_peers: members read their organization"
  on public.research_peers
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

create policy "research_peers: assigned experts read"
  on public.research_peers
  for select
  to authenticated
  using ((select private.is_assigned_expert(organization_id)));

create policy "research_peers: ops full access"
  on public.research_peers
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger research_peers_audit
  after insert or update or delete on public.research_peers
  for each row execute function private.audit_row();

-- Peer rows are written by the task alone (service role). The app roles keep SELECT (RLS scopes
-- it) and lose every write verb outright, so a member's insert fails on the grant, not only on a
-- missing policy; ops reach their full access policy through the service client only. TRUNCATE
-- walks around RLS and fires no row trigger, so it is revoked from every role as on every table.
-- The declarative diff drops these revokes after a table level REVOKE, so the migration re adds
-- them by hand (AGENTS.md).
revoke insert, update, delete, truncate on public.research_peers from anon, authenticated;
revoke truncate on public.research_peers from service_role;

-- No signed out caller ever reads a peer row.
revoke all on public.research_peers from anon;
