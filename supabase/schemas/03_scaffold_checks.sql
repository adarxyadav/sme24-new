-- Scaffold smoke test table: a Trigger.dev task writes a row, the ops admin page shows it live.
-- Exercises the whole path from spec 0001 (task -> service client -> RLS -> Realtime).
-- Feature 3 may drop or replace it; nothing else depends on it.

create table public.scaffold_checks (
  id uuid primary key default gen_random_uuid(),
  run_id text not null,
  message text not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.scaffold_checks is 'Scaffold smoke test rows written by the scaffold-check task. Ops only.';

create index scaffold_checks_created_at_idx on public.scaffold_checks (created_at desc);

alter table public.scaffold_checks enable row level security;

-- Only ops read; nobody but the service key writes.
create policy "scaffold_checks: ops read"
  on public.scaffold_checks
  for select
  to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'ops');

create trigger scaffold_checks_set_updated_at
  before update on public.scaffold_checks
  for each row execute function public.set_updated_at();
