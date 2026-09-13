-- Peer figures (spec 0021, kind G): one published safety figure of a peer company for one KPI,
-- year and basis, stored in the KPI's own unit beside the value and unit as printed, with the page
-- it was read from and the person who read it. A figure without `verified_at` is work in
-- progress: the benchmark task never loads it and the launch gate counts it. Seeded from
-- supabase/seed-data/peer-figures.csv the same way as peer_companies; a retired company takes
-- its figures with it. Not audited: reference data belongs to migrations and ops.

create table public.peer_figures (
  id uuid primary key default gen_random_uuid(),
  peer_key text not null references public.peer_companies (key) on delete cascade,
  kpi_key text not null references public.kpi_definitions (key)
    check (kpi_key in ('ltifr', 'trifr', 'lost_days_per_incident', 'iso_45001_certified')),
  period_year integer not null check (period_year between 2000 and 2100),
  value numeric not null,
  value_as_published numeric not null,
  unit_as_published text not null
    check (unit_as_published in ('per_million_hours', 'per_200k_hours', 'days', 'boolean')),
  basis text not null check (basis in ('employees', 'employees_and_contractors')),
  source_url text not null,
  verified_at timestamptz null,
  verified_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint peer_figures_verified_pair check ((verified_at is null) = (verified_by is null)),
  constraint peer_figures_peer_kpi_year_basis_key unique (peer_key, kpi_key, period_year, basis)
);

comment on table public.peer_figures is 'Published safety figures of the peer companies (spec 0021). Every signed in user reads; ops and migrations write; nobody deletes through the app roles.';
comment on column public.peer_figures.value is 'The figure in the KPI''s own unit: a per 200 000 hours rate is stored times five (spec 0021, AC-13), days and per million hours as printed, a boolean as 0 or 1.';
comment on column public.peer_figures.value_as_published is 'The figure exactly as the report prints it, shown in the table''s tooltip with its unit.';
comment on column public.peer_figures.basis is 'What the figure counts: own employees only, or employees and contractors together.';
comment on column public.peer_figures.verified_at is 'When a person read the source page; null means work in progress, skipped by the task and counted by the launch gate.';
comment on column public.peer_figures.verified_by is 'The curator''s name, present exactly when verified_at is; never rendered to a client.';

-- The task reads by KPI, and the foreign key column gets its own index (the cascade walks it).
create index peer_figures_kpi_key_period_year_idx on public.peer_figures (kpi_key, period_year);
create index peer_figures_peer_key_idx on public.peer_figures (peer_key);

alter table public.peer_figures enable row level security;

create policy "peer_figures: signed in users read"
  on public.peer_figures
  for select
  to authenticated
  using (true);

create policy "peer_figures: ops insert"
  on public.peer_figures
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "peer_figures: ops update"
  on public.peer_figures
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger peer_figures_set_updated_at
  before update on public.peer_figures
  for each row execute function public.set_updated_at();

-- As on peer_companies: no app role truncates, and no policy allows a delete.
revoke truncate on public.peer_figures from anon, authenticated, service_role;
