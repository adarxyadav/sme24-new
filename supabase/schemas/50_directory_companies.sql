-- Directory companies (spec 0018, kind G: global reference data, restricted). One row per company
-- in the purchased contact list, the parent of public.directory_contacts. Loaded only by the hand
-- run import script (service role) and removed only by public.directory_remove_contact.
--
-- DEVIATION FROM KIND G (spec 0002): kind G says every signed in user reads. Here nobody reads
-- the table directly: the data is personal and priced, so the only read path for an expert is
-- public.directory_search, a security definer function that masks every email and phone and
-- checks the caller's role and status. Ops read the table through the one policy below. There is
-- no audit trigger: an import writes tens of thousands of rows in one run, and the
-- public.directory_imports row is the audit of that run, the same reasoning public.packages gives.
--
-- The raw list never enters the repository (invariant 11): tests use invented rows, and
-- `pnpm directory:import` reads the workbook from a path outside the tree.

-- pg_trgm backs the two "contains" searches. The declarative engine loads the schema files into
-- a shadow database on their own, so the extension has to be declared here for the trigram
-- indexes below to build; the hand written migration 20260912013000_pg_trgm.sql is what actually
-- installs it in every real database, because the engine emits no extension statements.
create extension if not exists pg_trgm with schema extensions;

create table public.directory_companies (
  id uuid primary key default gen_random_uuid(),
  -- As in the list, trimmed.
  name text not null check (char_length(name) between 1 and 300),
  -- lower, trimmed, inner whitespace collapsed: the import key and the search sort key. Written
  -- by normaliseCompanyName in src/features/directory/normalise.ts, never derived here.
  name_normalised text not null check (char_length(name_normalised) between 1 and 300),
  -- ISO 3166 alpha 2 from the import map; null when the list gave none.
  country text null check (country ~ '^[A-Z]{2}$'),
  city text null check (char_length(city) <= 200),
  state text null check (char_length(state) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.directory_companies is 'A company on the purchased contact list (spec 0018). Unreadable to every app role but ops; experts see it only through directory_search. Written by the import script and directory_remove_contact.';
comment on column public.directory_companies.name_normalised is 'lower(trim(name)) with inner whitespace collapsed: the import upsert key (with country) and the keyset sort key of directory_search.';

-- The import upsert key: one row per normalised name and country, with a missing country
-- counted as its own value so two rows without one still collapse.
create unique index directory_companies_name_country_idx
  on public.directory_companies (name_normalised, coalesce(country, ''));
-- The keyset order of directory_search.
create index directory_companies_name_normalised_idx on public.directory_companies (name_normalised);
-- The "company name contains" search. pg_trgm lives in the extensions schema (a hand written
-- migration installs it), and the operator class is named with its schema because the definer
-- functions run with an empty search_path.
create index directory_companies_name_trgm_idx
  on public.directory_companies using gin (name extensions.gin_trgm_ops);

alter table public.directory_companies enable row level security;

-- The only policy. No expert, no client, no anonymous visitor reads a row directly.
create policy "directory_companies: ops read"
  on public.directory_companies
  for select
  to authenticated
  using ((select private.is_ops()));

create trigger directory_companies_set_updated_at
  before update on public.directory_companies
  for each row execute function public.set_updated_at();

-- Only the service role writes (the import script, directory_remove_contact). The whole verb is
-- revoked, nothing granted back per column.
revoke insert, update, delete on public.directory_companies from anon, authenticated;

-- TRUNCATE walks around RLS and fires no row trigger; revoked from every role like every table.
revoke truncate on public.directory_companies from anon, authenticated, service_role;
