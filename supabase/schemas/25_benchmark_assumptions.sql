-- Benchmark assumptions (spec 0008, kind G): the seven stored, sourced constants of the incident
-- cost model (hours per FTE, direct cost per case, cost per absence day, default lost days, the
-- three indirect cost multipliers). One row per key, no selection rule: `effective_from` only
-- documents the date the value refers to. Seeded by the generated migration of
-- `pnpm benchmarks:migration` from supabase/seed-data/benchmark-assumptions.csv. Not audited.

create table public.benchmark_assumptions (
  key text primary key,
  value numeric not null,
  unit text not null,
  label jsonb not null check (jsonb_typeof(label) = 'object' and label ? 'de' and label ? 'en'),
  source_name text not null,
  source_url text null,
  note jsonb null check (
    note is null
    or (jsonb_typeof(note) = 'object' and note ? 'de' and note ? 'en')
  ),
  provisional boolean not null default true,
  effective_from date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.benchmark_assumptions is 'The stored constants of the incident cost model (spec 0008), one row per key. Every signed in user reads; ops and migrations write.';
comment on column public.benchmark_assumptions.effective_from is 'The date the value refers to; documentation only, key is the primary key.';

alter table public.benchmark_assumptions enable row level security;

create policy "benchmark_assumptions: signed in users read"
  on public.benchmark_assumptions
  for select
  to authenticated
  using (true);

create policy "benchmark_assumptions: ops insert"
  on public.benchmark_assumptions
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "benchmark_assumptions: ops update"
  on public.benchmark_assumptions
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger benchmark_assumptions_set_updated_at
  before update on public.benchmark_assumptions
  for each row execute function public.set_updated_at();

-- TRUNCATE walks around RLS and fires no row trigger; Supabase's default privileges hand it to
-- all three app roles at creation. DELETE is left to RLS, which already filters it.
revoke truncate on public.benchmark_assumptions from anon, authenticated, service_role;
