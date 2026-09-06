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

-- True when the caller is an expert with an active assignment to the organization. Definer so
-- the policy on expert_assignments itself does not recurse; the auth.uid() check keeps it safe.
create or replace function private.is_assigned_expert(org uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null or org is null or private.jwt_app_role() is distinct from 'expert' then
    return false;
  end if;
  return exists (
    select 1
    from public.expert_assignments a
    where a.organization_id = org
      and a.expert_id = caller
      and a.status = 'active'
  );
end;
$$;

-- True while the organization has fewer than 5 research runs created in the last 24 hours
-- (spec 0007, AC-2). Rows the action failed at once (`error_code = 'trigger_failed'`) do not
-- count; stale rows do. Definer so the insert policy on research_runs does not recurse through
-- RLS; the count is not serialised, so two simultaneous inserts can overshoot by one (accepted,
-- the open run index bounds the damage). The limit mirrors RUN_LIMIT_PER_DAY in
-- src/features/research/catalogue.ts.
create or replace function private.research_run_allowed(organization_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if organization_id is null then
    return false;
  end if;
  return (
    select count(*)
    from public.research_runs r
    where r.organization_id = research_run_allowed.organization_id
      and r.created_at > now() - interval '24 hours'
      and r.error_code is distinct from 'trigger_failed'
  ) < 5;
end;
$$;

revoke execute on function private.jwt_app_role() from public;
revoke execute on function private.jwt_org_id() from public;
revoke execute on function private.is_ops() from public;
revoke execute on function private.is_org_owner(uuid) from public;
revoke execute on function private.is_assigned_expert(uuid) from public;
revoke execute on function private.research_run_allowed(uuid) from public, anon;
grant execute on function private.jwt_app_role() to authenticated, service_role;
grant execute on function private.jwt_org_id() to authenticated, service_role;
grant execute on function private.is_ops() to authenticated, service_role;
grant execute on function private.is_org_owner(uuid) to authenticated, service_role;
grant execute on function private.is_assigned_expert(uuid) to authenticated, service_role;
grant execute on function private.research_run_allowed(uuid) to authenticated, service_role;
