-- Expert assignments (spec 0002, kind T): the bridge that lets an expert cross into an
-- organization. An expert reads an organization's rows only while a row here is `active`.
-- Status moves active → ended once (ended_at is set); a new assignment is a new row. Insert and
-- update are ops only until feature 19 (matching) confirms a choice. Policies use direct
-- predicates (expert_id = auth.uid()) rather than the helper that reads this table.

create table public.expert_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  expert_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  assigned_by uuid null references public.profiles (id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.expert_assignments is 'An expert''s access to one organization. Active rows grant read access through private.is_assigned_expert.';

create unique index expert_assignments_active_organization_expert_idx
  on public.expert_assignments (organization_id, expert_id)
  where status = 'active';
create index expert_assignments_active_expert_idx
  on public.expert_assignments (expert_id)
  where status = 'active';
create index expert_assignments_organization_id_created_at_idx
  on public.expert_assignments (organization_id, created_at desc);
create index expert_assignments_assigned_by_idx on public.expert_assignments (assigned_by);

alter table public.expert_assignments enable row level security;

create policy "expert_assignments: members read their organization"
  on public.expert_assignments
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

create policy "expert_assignments: experts read their own rows"
  on public.expert_assignments
  for select
  to authenticated
  using (expert_id = (select auth.uid()));

create policy "expert_assignments: ops full access"
  on public.expert_assignments
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- active → ended only, and ended_at is set on the way; anything else raises. Fires only when
-- an update names the status column, so other columns stay editable.
create or replace function private.check_expert_assignment_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'ended' then
    new.ended_at := coalesce(new.ended_at, now());
    return new;
  end if;
  raise exception 'invalid expert_assignments transition % -> % on %', old.status, new.status, old.id
    using errcode = 'check_violation';
end;
$$;

revoke execute on function private.check_expert_assignment_transition() from public;

create trigger expert_assignments_check_transition
  before update of status on public.expert_assignments
  for each row execute function private.check_expert_assignment_transition();

-- Only an `active` expert can be assigned (spec 0013, AC-9). The rule lives here rather than in
-- the ops action so a deactivation racing an assign cannot leave an assignment on an expert who
-- has just left the network, and so feature 19 (matching) inherits it for free. The function is
-- declared in this file because it reads expert_profiles, which 13_expert_profiles.sql creates;
-- plpgsql resolves the body at call time, so the ordering between the two files does not matter.
-- Definer, like the other helpers that read a table: RLS on expert_profiles hides every row from
-- a client, so an invoker function would read no row and report "not active" for a perfectly
-- active expert. Reading the status is safe to do as the owner: the trigger only ever compares it
-- and never returns it.
--
-- The guard at the top is not authorization, RLS is: it is there because Postgres runs a
-- `before insert` trigger ahead of the policy's `with check`, so without it a client's insert
-- (which RLS refuses a moment later) would first raise expert_not_active and tell an unauthorized
-- caller whether that expert exists and is active. Skipping the check for a caller who cannot
-- insert anyway hands the refusal back to RLS, which answers 42501 and says nothing. Ops and the
-- service role (the two that can actually insert, plus the seed and migrations, which carry no
-- claims at all) always go through the check, so the invariant still holds for every real write.
-- When feature 19 lets another caller assign, this guard widens with the insert policy it mirrors.
create or replace function private.check_expert_assignable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  expert_status text;
begin
  if private.jwt_app_role() in ('client', 'expert') then
    return new;
  end if;

  select e.status into expert_status
  from public.expert_profiles e
  where e.expert_id = new.expert_id;

  if expert_status is distinct from 'active' then
    raise exception 'expert_not_active: % is %', new.expert_id, coalesce(expert_status, 'without a profile')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function private.check_expert_assignable() from public;

create trigger expert_assignments_check_assignable
  before insert on public.expert_assignments
  for each row execute function private.check_expert_assignable();

create trigger expert_assignments_set_updated_at
  before update on public.expert_assignments
  for each row execute function public.set_updated_at();

create trigger expert_assignments_audit
  after insert or update or delete on public.expert_assignments
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.expert_assignments from anon, authenticated, service_role;
