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
  -- The organisation's language (spec 0004): reports and organisation wide mail use it even when
  -- a colleague works in the other language. Mirrors the short codes in src/i18n/routing.ts.
  locale text not null default 'de' check (locale in ('de', 'en')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is 'A client company account, the tenant every kind T table belongs to. Insert only through create_organization.';
comment on column public.organizations.archived_at is 'A closed account that keeps its data until an erasure request (feature 14).';
comment on column public.organizations.locale is 'Language of the organisation''s documents and organisation wide mail: de or en. Copied from the creator''s profile, editable by an owner.';

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

-- Owners rename their organization and set its language. Narrowing this cannot be done in the policy (a
-- with check that reads organizations recurses) nor with a column grant (the `authenticated`
-- role is shared with ops, so it would restrict ops too), so the trigger below pins the columns
-- an owner must not move.
create policy "organizations: owners update their organization"
  on public.organizations
  for update
  to authenticated
  using ((select private.is_org_owner(id)))
  with check ((select private.is_org_owner(id)));

create policy "organizations: assigned experts read"
  on public.organizations
  for select
  to authenticated
  using ((select private.is_assigned_expert(id)));

create policy "organizations: ops full access"
  on public.organizations
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- An owner may change the name and the locale and nothing else. archived_at is the column that
-- matters: it will mean "closed account" to feature 14, so it is pinned before that feature
-- exists rather than after. Ops and the service client are unaffected, which is why this is a
-- trigger keyed on the caller's role rather than a column grant.
create or replace function private.check_organization_owner_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_ops() then
    return new;
  end if;
  if new.archived_at is distinct from old.archived_at
     or new.created_by is distinct from old.created_by
     or new.id is distinct from old.id then
    raise exception 'only name and locale are editable by an owner'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_organization_owner_columns() from public;

create trigger organizations_check_owner_columns
  before update on public.organizations
  for each row execute function private.check_organization_owner_columns();

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create trigger organizations_audit
  after insert or update or delete on public.organizations
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.organizations from anon, authenticated, service_role;
