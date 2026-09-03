-- Organizations (spec 0002, kind T: the tenant itself). One client company account; every
-- tenant table points here with `organization_id`. Deleting an organization cascades through
-- every tenant table; the audit log keeps the trail because it has no foreign key.
-- Rows are created only through public.create_organization (11_organization_members.sql);
-- there is no insert policy for members.

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 200),
  created_by uuid null references public.profiles (id) on delete set null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'A client company account, the tenant every kind T table belongs to. Insert only through create_organization.';
comment on column public.organizations.archived_at is 'A closed account that keeps its data until an erasure request (feature 14).';

create index organizations_created_by_idx on public.organizations (created_by);

-- profiles.organization_id is the user's current organization. The constraint lives here
-- because organizations is created after profiles in schema file order.
alter table public.profiles
  add constraint profiles_organization_id_fkey
  foreign key (organization_id) references public.organizations (id) on delete set null;

create index profiles_organization_id_idx on public.profiles (organization_id);

alter table public.organizations enable row level security;

create policy "organizations: members read their organization"
  on public.organizations
  for select
  to authenticated
  using (id = (select private.jwt_org_id()));

-- Owners rename their organization. Column narrowing to `name` is by policy intent: the
-- `authenticated` role is shared with ops, so a column grant would restrict ops as well.
create policy "organizations: owners update their organization"
  on public.organizations
  for update
  to authenticated
  using ((select private.is_org_owner(id)))
  with check ((select private.is_org_owner(id)));

create policy "organizations: ops full access"
  on public.organizations
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();
