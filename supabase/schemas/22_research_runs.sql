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

create index research_runs_organization_id_created_at_idx on public.research_runs (organization_id, created_at desc);
create index research_runs_company_id_created_at_idx on public.research_runs (company_id, created_at desc);
create index research_runs_open_status_idx on public.research_runs (status) where status in ('queued', 'running');
create index research_runs_requested_by_idx on public.research_runs (requested_by);

alter table public.research_runs enable row level security;

create policy "research_runs: members read their organization"
  on public.research_runs
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- A member requests a run: their own organization, themselves as requester, status queued, and
-- a company of that organization (the subquery runs under the member's own companies policy).
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
