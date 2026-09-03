-- Company KPIs (spec 0002, kind T): one value per company, KPI and year, either extracted by a
-- research run (source research, written by the task through the service client) or entered by
-- the client (source client, feature 10). Members touch only their own client rows.
-- company_kpi_current picks the effective row: the client row when one exists, else the newest
-- research row.

create table public.company_kpis (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  research_run_id uuid null references public.research_runs (id) on delete set null,
  kpi_key text not null references public.kpi_definitions (key),
  period_year integer not null check (period_year between 2000 and 2100),
  value numeric not null,
  source text not null check (source in ('research', 'client')),
  confidence numeric null check (confidence between 0 and 1),
  sources jsonb not null default '[]' check (jsonb_typeof(sources) = 'array'),
  note text null,
  created_by uuid null references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.company_kpis is 'A KPI value per company, KPI and year, from research or entered by the client.';
comment on column public.company_kpis.sources is 'Array of {url, title, excerpt, retrieved_at} the value was taken from.';

create unique index company_kpis_research_run_kpi_year_idx
  on public.company_kpis (research_run_id, kpi_key, period_year)
  where research_run_id is not null;
create unique index company_kpis_client_company_kpi_year_idx
  on public.company_kpis (company_id, kpi_key, period_year)
  where source = 'client';
create index company_kpis_organization_id_idx on public.company_kpis (organization_id);
create index company_kpis_company_kpi_year_idx on public.company_kpis (company_id, kpi_key, period_year);
create index company_kpis_kpi_key_idx on public.company_kpis (kpi_key);
create index company_kpis_created_by_idx on public.company_kpis (created_by);

alter table public.company_kpis enable row level security;

create policy "company_kpis: members read their organization"
  on public.company_kpis
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- Members write only their own client rows, for a company of their organization.
create policy "company_kpis: members insert client rows"
  on public.company_kpis
  for insert
  to authenticated
  with check (
    organization_id = (select private.jwt_org_id())
    and source = 'client'
    and created_by = (select auth.uid())
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.organization_id = company_kpis.organization_id
    )
  );

create policy "company_kpis: members update their client rows"
  on public.company_kpis
  for update
  to authenticated
  using (
    organization_id = (select private.jwt_org_id())
    and source = 'client'
    and created_by = (select auth.uid())
  )
  with check (
    organization_id = (select private.jwt_org_id())
    and source = 'client'
    and created_by = (select auth.uid())
  );

create policy "company_kpis: members delete their client rows"
  on public.company_kpis
  for delete
  to authenticated
  using (
    organization_id = (select private.jwt_org_id())
    and source = 'client'
    and created_by = (select auth.uid())
  );

create policy "company_kpis: assigned experts read"
  on public.company_kpis
  for select
  to authenticated
  using ((select private.is_assigned_expert(organization_id)));

create policy "company_kpis: ops full access"
  on public.company_kpis
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger company_kpis_set_updated_at
  before update on public.company_kpis
  for each row execute function public.set_updated_at();

create trigger company_kpis_audit
  after insert or update or delete on public.company_kpis
  for each row execute function private.audit_row();

-- The effective value per (company, KPI, year): the client row wins, else the newest research
-- row. security_invoker so the caller's company_kpis policies apply.
create view public.company_kpi_current
with (security_invoker = true)
as
select distinct on (company_id, kpi_key, period_year) *
from public.company_kpis
order by company_id, kpi_key, period_year, (source = 'client') desc, created_at desc;

comment on view public.company_kpi_current is 'One row per company, KPI and year: the client row when present, else the newest research row.';
