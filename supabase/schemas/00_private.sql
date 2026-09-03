-- Private helpers (spec 0002). The `private` schema is not in [api].schemas, so PostgREST never
-- exposes these as RPCs. Policies call them as the signed in user, which is why `authenticated`
-- needs usage on the schema and execute on each function. The declarative diff does not track
-- grants, so every migration that adds a function here repeats its grant lines by hand.
--
-- Helpers that read a table (is_org_owner, is_assigned_expert) are `security definer` so a policy
-- on that same table does not recurse through RLS; the `auth.uid()` check in the body is what
-- keeps them safe. They are plpgsql so their bodies resolve at call time, which lets this file
-- run before the tables it names exist.

create schema if not exists private;

grant usage on schema private to authenticated, service_role;

-- The app role from the access token (app_metadata.role, written by the token hook).
create or replace function private.jwt_app_role()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role';
$$;

-- The caller's current organization from the access token (app_metadata.organization_id).
create or replace function private.jwt_org_id()
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'organization_id', '')::uuid;
$$;

-- True for the ops role. Null (no token) counts as false in a policy.
create or replace function private.is_ops()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(private.jwt_app_role() = 'ops', false);
$$;

-- True when the caller holds an owner membership of the organization. Definer: a policy on
-- organization_members that read organization_members through RLS would recurse.
create or replace function private.is_org_owner(org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or org is null then
    return false;
  end if;
  return exists (
    select 1
    from public.organization_members m
    where m.organization_id = org
      and m.user_id = caller
      and m.role = 'owner'
  );
end;
$$;

revoke execute on function private.jwt_app_role() from public;
revoke execute on function private.jwt_org_id() from public;
revoke execute on function private.is_ops() from public;
revoke execute on function private.is_org_owner(uuid) from public;
grant execute on function private.jwt_app_role() to authenticated, service_role;
grant execute on function private.jwt_org_id() to authenticated, service_role;
grant execute on function private.is_ops() to authenticated, service_role;
grant execute on function private.is_org_owner(uuid) to authenticated, service_role;
