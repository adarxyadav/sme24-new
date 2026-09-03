-- Companies (spec 0002, kind T): the assessed company. One organization may hold several (a
-- group and its subsidiaries). Members archive, never delete; ops delete.

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  legal_name text null,
  uid text null,
  website text null,
  industry_code text null,
  employees_count integer null check (employees_count >= 0),
  canton text null check (canton ~ '^[A-Z]{2}$'),
  country text not null default 'CH',
  created_by uuid null references public.profiles (id) on delete set null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.companies is 'An assessed company inside an organization.';
comment on column public.companies.uid is 'The Swiss company identifier (CHE-…).';
comment on column public.companies.industry_code is 'NOGA industry code.';

create index companies_organization_id_created_at_idx on public.companies (organization_id, created_at desc);
create unique index companies_organization_id_uid_idx on public.companies (organization_id, uid) where uid is not null;
create index companies_created_by_idx on public.companies (created_by);

alter table public.companies enable row level security;

create policy "companies: members read their organization"
  on public.companies
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

create policy "companies: members insert into their organization"
  on public.companies
  for insert
  to authenticated
  with check (organization_id = (select private.jwt_org_id()));

create policy "companies: members update their organization"
  on public.companies
  for update
  to authenticated
  using (organization_id = (select private.jwt_org_id()))
  with check (organization_id = (select private.jwt_org_id()));

create policy "companies: assigned experts read"
  on public.companies
  for select
  to authenticated
  using ((select private.is_assigned_expert(organization_id)));

create policy "companies: ops full access"
  on public.companies
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger companies_set_updated_at
  before update on public.companies
  for each row execute function public.set_updated_at();

create trigger companies_audit
  after insert or update or delete on public.companies
  for each row execute function private.audit_row();
