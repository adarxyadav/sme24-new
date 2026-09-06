-- Benchmark snapshots (spec 0008, kind T): one immutable result of the benchmark computation per
-- company and trigger, written only by the benchmark-company task through the service client.
-- The blocks copy every input, peer row and assumption the computation used, so a number on the
-- dashboard traces back to this row and a later seed change never rewrites a stored result. The
-- newest row per company by created_at is what the dashboard shows. In the realtime publication
-- (90_realtime.sql) so the client page refreshes when a snapshot lands.

create table public.benchmark_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  research_run_id uuid null references public.research_runs (id) on delete set null,
  trigger_kind text not null check (trigger_kind in ('research', 'client_edit', 'recompute')),
  model_version text not null,
  peer_provisional boolean not null,
  kpis_compared integer not null check (kpis_compared between 0 and 8),
  confidence numeric null check (confidence between 0 and 1),
  cost_chf numeric null,
  cost_low_chf numeric null,
  cost_high_chf numeric null,
  saving_median_chf numeric null,
  saving_top_chf numeric null,
  inputs jsonb not null,
  results jsonb not null,
  gaps jsonb not null,
  cost jsonb null,
  assumptions jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.benchmark_snapshots is 'An immutable benchmark result per company (spec 0008): scalars for the card, blocks with the inputs, peer rows and assumptions used.';
comment on column public.benchmark_snapshots.model_version is 'The rule set and block schema that produced the row (benchmark-model@N); the reader picks the schema by it.';
comment on column public.benchmark_snapshots.updated_at is 'Present for the tenant table contract; no app path updates a snapshot.';

create index benchmark_snapshots_organization_id_created_at_idx on public.benchmark_snapshots (organization_id, created_at desc);
create index benchmark_snapshots_company_id_created_at_idx on public.benchmark_snapshots (company_id, created_at desc);
create index benchmark_snapshots_research_run_id_idx on public.benchmark_snapshots (research_run_id);

alter table public.benchmark_snapshots enable row level security;

-- Members and experts only read; there is deliberately no member insert, update or delete policy,
-- and the write grants below are revoked so no later policy can open them by accident.
create policy "benchmark_snapshots: members read their organization"
  on public.benchmark_snapshots
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

create policy "benchmark_snapshots: assigned experts read"
  on public.benchmark_snapshots
  for select
  to authenticated
  using ((select private.is_assigned_expert(organization_id)));

create policy "benchmark_snapshots: ops full access"
  on public.benchmark_snapshots
  for all
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger benchmark_snapshots_set_updated_at
  before update on public.benchmark_snapshots
  for each row execute function public.set_updated_at();

create trigger benchmark_snapshots_audit
  after insert or update or delete on public.benchmark_snapshots
  for each row execute function private.audit_row();

-- Snapshots are written by the task alone (service role). The app roles keep SELECT (RLS scopes
-- it) and lose every write verb outright, so a member's insert fails on the grant, not only on a
-- policy (spec 0008, AC-15). Ops reach their full access policy through the service client only.
-- TRUNCATE is revoked from every app role as on every table. The declarative diff drops these
-- revokes after a table level REVOKE, so the migration re adds them by hand (AGENTS.md).
revoke insert, update, delete, truncate on public.benchmark_snapshots from anon, authenticated;
revoke truncate on public.benchmark_snapshots from service_role;
