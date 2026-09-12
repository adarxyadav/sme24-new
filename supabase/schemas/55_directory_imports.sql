-- Directory imports (spec 0018, kind I: internal). One row per run of `pnpm directory:import`,
-- dry runs included: the counts per outcome and per country, the policy the run applied and when
-- it started and finished. This row is the audit of every bulk write to the directory (the four
-- restricted tables carry no audit trigger), so ops read it on /admin/directory and nothing
-- else ever reads it. Written by the import script through the service role only.

create table public.directory_imports (
  id uuid primary key default gen_random_uuid(),
  source_batch text not null check (char_length(source_batch) between 1 and 200),
  -- The base name only, never a path from the operator's machine.
  file_name text not null check (char_length(file_name) between 1 and 300),
  rows_read integer not null default 0 check (rows_read >= 0),
  rows_loaded integer not null default 0 check (rows_loaded >= 0),
  rows_updated integer not null default 0 check (rows_updated >= 0),
  rows_skipped_invalid integer not null default 0 check (rows_skipped_invalid >= 0),
  rows_skipped_country integer not null default 0 check (rows_skipped_country >= 0),
  rows_skipped_no_country integer not null default 0 check (rows_skipped_no_country >= 0),
  rows_skipped_suppressed integer not null default 0 check (rows_skipped_suppressed >= 0),
  -- Loaded counts per alpha 2 code, {"CH": 1200, "DE": 3400}.
  countries jsonb not null default '{}'::jsonb,
  -- IMPORT_POLICY.excludedCountries at the time of the run.
  excluded_countries text[] not null default '{}',
  dry_run boolean not null default false,
  started_at timestamptz not null default now(),
  finished_at timestamptz null,
  created_at timestamptz not null default now()
);

comment on table public.directory_imports is 'One row per run of pnpm directory:import (spec 0018): counts per outcome and per country, the policy applied, dry runs included. The audit of every bulk write to the directory.';

create index directory_imports_started_at_idx on public.directory_imports (started_at desc);

alter table public.directory_imports enable row level security;

create policy "directory_imports: ops read"
  on public.directory_imports
  for select
  to authenticated
  using ((select private.is_ops()));

revoke insert, update, delete on public.directory_imports from anon, authenticated;
revoke truncate on public.directory_imports from anon, authenticated, service_role;
