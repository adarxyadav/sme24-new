-- KPI definitions (spec 0002, kind G): the catalogue of safety KPIs every organization's values
-- refer to. Names and descriptions are keyed by locale ({"de": …, "en": …}); a later language
-- is a key, not a column. Feature 8 seeds the rows through a data migration. Not audited:
-- reference data belongs to migrations and ops.

create table public.kpi_definitions (
  key text primary key,
  name jsonb not null check (jsonb_typeof(name) = 'object' and name ? 'de' and name ? 'en'),
  description jsonb null check (
    description is null
    or (jsonb_typeof(description) = 'object' and description ? 'de' and description ? 'en')
  ),
  unit text not null,
  direction text not null check (direction in ('lower_is_better', 'higher_is_better', 'neutral')),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.kpi_definitions is 'Global catalogue of safety KPIs (for example ltifr). Every signed in user reads; ops write.';

alter table public.kpi_definitions enable row level security;

create policy "kpi_definitions: signed in users read"
  on public.kpi_definitions
  for select
  to authenticated
  using (true);

create policy "kpi_definitions: ops insert"
  on public.kpi_definitions
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "kpi_definitions: ops update"
  on public.kpi_definitions
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger kpi_definitions_set_updated_at
  before update on public.kpi_definitions
  for each row execute function public.set_updated_at();
