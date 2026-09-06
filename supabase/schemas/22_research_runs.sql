-- Research runs (spec 0002, kind T): one AI research job per company. The client's insert
-- creates it as `queued` with themselves as requested_by; the research task (feature 8) moves
-- it on through the service client; the transition trigger rejects every other move.
-- In the realtime publication (90_realtime.sql) so the client page follows progress live.

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'empty', 'failed')),
  trigger_run_id text null,
  provider_run_id text null,
  requested_by uuid null references public.profiles (id) on delete set null,
  started_at timestamptz null,
  finished_at timestamptz null,
  error_code text null,
  error_message text null,
  summary jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.research_runs is 'One research job per company: queued → running → succeeded | empty | failed (queued → failed allowed).';
comment on column public.research_runs.error_message is 'A message safe to show to the client; details go to Sentry.';
comment on column public.research_runs.summary is 'What feature 8 shows about sources and coverage.';
comment on column public.research_runs.provider_run_id is 'The research provider''s run id (spec 0007): written before the first poll so a retry resumes instead of paying twice.';

create index research_runs_organization_id_created_at_idx on public.research_runs (organization_id, created_at desc);
create index research_runs_company_id_created_at_idx on public.research_runs (company_id, created_at desc);
create index research_runs_open_status_idx on public.research_runs (status) where status in ('queued', 'running');
create index research_runs_requested_by_idx on public.research_runs (requested_by);
-- At most one open run per company (spec 0007, AC-2); the actions map the violation to run_in_progress.
create unique index research_runs_one_open_per_company_idx
  on public.research_runs (company_id)
  where status in ('queued', 'running');

alter table public.research_runs enable row level security;

create policy "research_runs: members read their organization"
  on public.research_runs
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- A member requests a run: their own organization, themselves as requester, status queued, a
-- company of that organization (the subquery runs under the member's own companies policy), and
-- fewer than 5 runs in the last 24 hours (spec 0007, AC-2; the action maps 42501 to quota_exceeded).
create policy "research_runs: members request a run for their organization"
  on public.research_runs
  for insert
  to authenticated
  with check (
    organization_id = (select private.jwt_org_id())
    and requested_by = (select auth.uid())
    and status = 'queued'
    and exists (
      select 1 from public.companies c
      where c.id = company_id and c.organization_id = research_runs.organization_id
    )
    and (select private.research_run_allowed(organization_id))
  );

-- A member closes their own queued run when the trigger call failed (spec 0007, AC-2, AC-3):
-- own organization, own request, still queued; the row may only become failed (or stay queued
-- to store the trigger run id). The column grant below limits what those updates may touch.
create policy "research_runs: members close their own queued run"
  on public.research_runs
  for update
  to authenticated
  using (
    organization_id = (select private.jwt_org_id())
    and requested_by = (select auth.uid())
    and status = 'queued'
  )
  with check (
    organization_id = (select private.jwt_org_id())
    and requested_by = (select auth.uid())
    and status in ('queued', 'failed')
  );

create policy "research_runs: assigned experts read"
  on public.research_runs
  for select
  to authenticated
  using ((select private.is_assigned_expert(organization_id)));

create policy "research_runs: ops full access"
  on public.research_runs
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- The state machine. Fires only when an update names the status column, so a repeat of an end
-- state raises while other columns (summary, error_message) stay editable.
create or replace function private.check_research_run_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.status = 'queued' and new.status in ('running', 'failed'))
     or (old.status = 'running' and new.status in ('succeeded', 'empty', 'failed')) then
    return new;
  end if;
  raise exception 'invalid research_runs transition % -> %', old.status, new.status
    using errcode = 'check_violation';
end;
$$;

revoke execute on function private.check_research_run_transition() from public;

create trigger research_runs_check_transition
  before update of status on public.research_runs
  for each row execute function private.check_research_run_transition();

create trigger research_runs_set_updated_at
  before update on public.research_runs
  for each row execute function public.set_updated_at();

create trigger research_runs_audit
  after insert or update or delete on public.research_runs
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once and
-- leave nothing in the audit log; Supabase's default privileges hand it to all three app roles
-- at creation. DELETE is deliberately left alone: no policy grants it, so RLS already filters it
-- to zero rows, and revoking the verb would turn that into a hard error instead.
revoke truncate on public.research_runs from anon, authenticated, service_role;

-- The members update policy above only ever needs five columns (spec 0007, AC-2): the table level
-- UPDATE is revoked from authenticated and granted back per column, so a member can never touch
-- summary, started_at or the ids even through their own queued row. Ops keep their full access
-- through the policy but share the grant, which is why ops writes go through the service client
-- (none exist in this feature). The declarative diff drops column grants after a table level
-- REVOKE, so a migration re adds this grant by hand (AGENTS.md).
revoke update on public.research_runs from authenticated;
grant update (status, error_code, error_message, trigger_run_id, finished_at) on public.research_runs to authenticated;
