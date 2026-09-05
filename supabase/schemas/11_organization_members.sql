-- Organization members (spec 0002, kind T). Who belongs to which organization and with which
-- role. A user belongs to one organization for now, enforced by create_organization and (from
-- feature 22) the invitation acceptance action, not by a constraint, so multi organization users
-- later need no migration. Policies use direct predicates on the token, never a helper that
-- reads this table.

create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

comment on table public.organization_members is 'Membership of a user in an organization with the role owner or member.';

create index organization_members_user_id_idx on public.organization_members (user_id);

alter table public.organization_members enable row level security;

create policy "organization_members: members read their organization"
  on public.organization_members
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- No insert policy for members on purpose. A policy can only see the row being written, so it
-- cannot tell a consenting join from an owner naming any user id; an owner who could insert an
-- arbitrary user_id would attach an ops or expert account to their own tenant, and the profile
-- sync trigger below would then mint that victim an organization claim. Owner adds go through
-- public.add_organization_member, which checks the target consented to join. Insert is revoked
-- from authenticated at the foot of this file, so no later policy can reopen the path.

create policy "organization_members: owners update within their organization"
  on public.organization_members
  for update
  to authenticated
  using (
    organization_id = (select private.jwt_org_id())
    and (select private.is_org_owner(organization_id))
  )
  with check (
    organization_id = (select private.jwt_org_id())
    and (select private.is_org_owner(organization_id))
  );

create policy "organization_members: owners delete within their organization"
  on public.organization_members
  for delete
  to authenticated
  using (
    organization_id = (select private.jwt_org_id())
    and (select private.is_org_owner(organization_id))
  );

create policy "organization_members: ops full access"
  on public.organization_members
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger organization_members_set_updated_at
  before update on public.organization_members
  for each row execute function public.set_updated_at();

create trigger organization_members_audit
  after insert or update or delete on public.organization_members
  for each row execute function private.audit_row();

-- Keep profiles.organization_id (the current organization) in step with memberships: after an
-- insert, set it when it is null; after a delete, clear it when it pointed at that organization.
-- The insert branch only ever writes a profile the membership row's own user asked for: either
-- the caller is that user (create_organization, an accepted invitation) or there is no caller at
-- all (ops through the service client, the seed, a migration). A membership row inserted for
-- someone else never rewrites their profile, so it can never mint them an organization claim.
create or replace function private.sync_profile_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if caller is not null and caller is distinct from new.user_id then
      return new;
    end if;
    update public.profiles
    set organization_id = new.organization_id
    where id = new.user_id and organization_id is null;
    return new;
  end if;

  update public.profiles
  set organization_id = null
  where id = old.user_id and organization_id = old.organization_id;
  return old;
end;
$$;

revoke execute on function private.sync_profile_organization() from public;

create trigger organization_members_sync_profile_organization
  after insert or delete on public.organization_members
  for each row execute function private.sync_profile_organization();

-- The only member facing insert path for organization_members. Runs as the signed in owner
-- (PostgREST rpc) and refuses unless the target consented to join: the target must be a client
-- who holds no membership anywhere and whose profile names no organization. That is the shape a
-- user has right up to the moment they accept, so this stays correct when feature 22 replaces the
-- consent check with a real invitation row. Refuses `not_an_owner`, `not_a_client`,
-- `already_member` or `invalid_role`.
create or replace function public.add_organization_member(
  organization_id uuid,
  user_id uuid,
  role text default 'member'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  member_id uuid;
begin
  if role not in ('owner', 'member') then
    raise exception 'invalid_role';
  end if;

  if caller is null
     or not private.is_org_owner(add_organization_member.organization_id) then
    raise exception 'not_an_owner';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = add_organization_member.user_id
      and p.role = 'client'
      and p.organization_id is null
  ) then
    raise exception 'not_a_client';
  end if;

  if exists (
    select 1 from public.organization_members m
    where m.user_id = add_organization_member.user_id
  ) then
    raise exception 'already_member';
  end if;

  insert into public.organization_members (organization_id, user_id, role)
  values (
    add_organization_member.organization_id,
    add_organization_member.user_id,
    add_organization_member.role
  )
  returning id into member_id;

  update public.profiles p
  set organization_id = add_organization_member.organization_id
  where p.id = add_organization_member.user_id and p.organization_id is null;

  return member_id;
end;
$$;

comment on function public.add_organization_member(uuid, uuid, text) is 'Owner adds a member to their organization. Only a client with no organization can be added.';

revoke execute on function public.add_organization_member(uuid, uuid, text) from anon, public;
grant execute on function public.add_organization_member(uuid, uuid, text) to authenticated;

-- No role may insert a membership row directly; public.add_organization_member (definer) is the
-- only member facing path, and ops go through the service client. Revoking the privilege rather
-- than relying on the absent policy means a later policy cannot reopen it by accident.
revoke insert on public.organization_members from anon, authenticated;

-- The only insert path for organizations. Runs as the signed in client (PostgREST rpc): creates
-- the organization (in the caller's stored language, spec 0004), the caller's owner membership and
-- the caller's current organization in one transaction and returns the new id. Refuses a caller
-- who is not a client (`not_a_client`) or who already belongs to an organization (`already_member`).
create or replace function public.create_organization(name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  org_id uuid;
begin
  if caller is null or private.jwt_app_role() is distinct from 'client' then
    raise exception 'not_a_client';
  end if;

  if exists (select 1 from public.organization_members m where m.user_id = caller) then
    raise exception 'already_member';
  end if;

  insert into public.organizations (name, created_by, locale)
  values (
    create_organization.name,
    caller,
    coalesce((select p.locale from public.profiles p where p.id = caller), 'de')
  )
  returning id into org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, caller, 'owner');

  update public.profiles
  set organization_id = org_id
  where id = caller and organization_id is distinct from org_id;

  return org_id;
end;
$$;

comment on function public.create_organization(text) is 'Creates an organization with the caller as owner. Client role only, one organization per user.';

revoke execute on function public.create_organization(text) from anon, public;
grant execute on function public.create_organization(text) to authenticated;

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.organization_members from anon, authenticated, service_role;
