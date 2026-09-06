-- Peer benchmarks (spec 0008, kind G): the curated peer values every organization's KPIs are
-- compared with. One row per KPI, NOGA section (or ALL), size band (or all) and reference year,
-- holding the quartiles of the peer distribution with the source it was read from. Seeded by the
-- generated migration of `pnpm benchmarks:migration` from supabase/seed-data/benchmarks.csv;
-- every row starts `provisional` and only the owner clears the flag from the published table.
-- Not audited: reference data belongs to migrations and ops.

create table public.benchmarks (
  id uuid primary key default gen_random_uuid(),
  kpi_key text not null references public.kpi_definitions (key),
  industry_section text not null check (industry_section ~ '^[A-U]$' or industry_section = 'ALL'),
  size_band text not null check (size_band in ('1-49', '50-249', '250+', 'all')),
  period_year integer not null check (period_year between 2000 and 2100),
  p25 numeric not null,
  median numeric not null,
  p75 numeric not null,
  sample_size integer null check (sample_size >= 0),
  source_name text not null,
  source_url text null,
  source_note jsonb null check (
    source_note is null
    or (jsonb_typeof(source_note) = 'object' and source_note ? 'de' and source_note ? 'en')
  ),
  provisional boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benchmarks_quartile_order check (p25 <= median and median <= p75),
  constraint benchmarks_kpi_section_band_year_key unique (kpi_key, industry_section, size_band, period_year)
);

comment on table public.benchmarks is 'Peer quartiles per KPI, NOGA section, size band and year (spec 0008). Every signed in user reads; ops and migrations write.';
comment on column public.benchmarks.industry_section is 'A NOGA 2008 section letter A to U, or ALL for every industry.';
comment on column public.benchmarks.size_band is '1-49, 50-249, 250+ or all.';
comment on column public.benchmarks.provisional is 'True until the owner replaced the value from the published table; the dashboard says so while any used row is provisional.';

alter table public.benchmarks enable row level security;

create policy "benchmarks: signed in users read"
  on public.benchmarks
  for select
  to authenticated
  using (true);

create policy "benchmarks: ops insert"
  on public.benchmarks
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "benchmarks: ops update"
  on public.benchmarks
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger benchmarks_set_updated_at
  before update on public.benchmarks
  for each row execute function public.set_updated_at();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe the peer table at once;
-- Supabase's default privileges hand it to all three app roles at creation. DELETE is left to
-- RLS, which already filters it: no policy allows one.
revoke truncate on public.benchmarks from anon, authenticated, service_role;
