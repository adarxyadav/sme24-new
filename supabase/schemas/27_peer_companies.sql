-- Peer companies (spec 0021, kind G): the curated library of named companies that print a safety
-- figure in a public report, one row per company with its country, NACE section, headcount and
-- the report it was read from. Seeded by the generated migration of `pnpm benchmarks:migration`
-- from supabase/seed-data/peer-companies.csv, which is the whole table: a row absent from the CSV
-- is retired by the migration. Nothing here belongs to a client; every signed in role reads.
-- Not audited: reference data belongs to migrations and ops.

create table public.peer_companies (
  key text primary key check (key ~ '^[a-z0-9-]+$'),
  name text not null,
  country text not null check (country ~ '^[A-Z]{2}$'),
  industry_section text not null check (industry_section ~ '^[A-U]$'),
  headcount integer not null check (headcount > 0),
  headcount_year integer not null check (headcount_year between 2000 and 2100),
  report_url text not null,
  note jsonb null check (
    note is null
    or (jsonb_typeof(note) = 'object' and note ? 'de' and note ? 'en')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.peer_companies is 'Named companies that publish a safety figure (spec 0021). Every signed in user reads; ops and migrations write; nobody deletes through the app roles.';
comment on column public.peer_companies.key is 'A stable lowercase slug, the CSV''s key and the snapshot''s peerKey.';
comment on column public.peer_companies.country is 'ISO 3166 alpha 2 of the headquarters; the peer ladder reads it through the country catalogue.';
comment on column public.peer_companies.industry_section is 'The NACE Rev. 2 section letter A to U; the task loads one section and never widens it.';
comment on column public.peer_companies.headcount is 'Total employees as the report prints them, with headcount_year; shown on every peer row so a listed group is never mistaken for a like sized peer.';
comment on column public.peer_companies.note is 'Localized {de, en} curator sentence on what the company''s figures count, or null.';

-- The task loads one section at a time (spec 0021, AC-5).
create index peer_companies_industry_section_idx on public.peer_companies (industry_section);

alter table public.peer_companies enable row level security;

create policy "peer_companies: signed in users read"
  on public.peer_companies
  for select
  to authenticated
  using (true);

create policy "peer_companies: ops insert"
  on public.peer_companies
  for insert
  to authenticated
  with check ((select private.is_ops()));

create policy "peer_companies: ops update"
  on public.peer_companies
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create trigger peer_companies_set_updated_at
  before update on public.peer_companies
  for each row execute function public.set_updated_at();

-- TRUNCATE walks around RLS and fires no row trigger; Supabase's default privileges hand it to
-- all three app roles at creation. DELETE is left to RLS, which already filters it: no policy
-- allows one, so a retired company goes out through the generated migration only.
revoke truncate on public.peer_companies from anon, authenticated, service_role;
