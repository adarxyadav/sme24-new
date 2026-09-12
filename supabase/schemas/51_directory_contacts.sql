-- Directory contacts (spec 0018, kind G: global reference data, restricted). One row per person
-- on the purchased list, keyed on the lowercased email. Holds the raw email and phones; the mask
-- lives in private.mask_email and private.mask_phone below, so a raw value never leaves Postgres
-- unmasked except through public.directory_reveal, which debits a credit first (AC-11).
--
-- DEVIATION FROM KIND G (spec 0002): as public.directory_companies. No select policy for an
-- expert or a client, so a direct read through PostgREST returns zero rows (AC-1); the two
-- definer read functions are the only path. No audit trigger: the import row is the audit.

create table public.directory_contacts (
  -- The id every event and unlock carries; opaque outside the database.
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.directory_companies (id) on delete cascade,
  -- Shown unmasked in results: the name is what a consultant searches for.
  first_name text null check (char_length(first_name) <= 200),
  last_name text null check (char_length(last_name) <= 200),
  title text null check (char_length(title) <= 300),
  -- The import key: lowercased, trimmed, a plausible address.
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- Kept as typed, trimmed.
  phone text null check (char_length(phone) <= 50),
  mobile text null check (char_length(mobile) <= 50),
  street text null check (char_length(street) <= 300),
  city text null check (char_length(city) <= 200),
  state text null check (char_length(state) <= 200),
  postal_code text null check (char_length(postal_code) <= 30),
  -- ISO 3166 alpha 2, the search filter column.
  country text null check (country ~ '^[A-Z]{2}$'),
  -- The workbook's source name, recorded on every row so a batch can be told apart later.
  source_batch text not null check (char_length(source_batch) between 1 and 200),
  -- Set by every upsert, so a row absent from the next file is findable.
  imported_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.directory_contacts is 'A person on the purchased contact list (spec 0018). Raw email and phones; unreadable to every app role but ops. directory_search masks them, directory_reveal returns them for one credit.';
comment on column public.directory_contacts.email is 'The import upsert key, lowercased. Never returned unmasked except by directory_reveal after a debit, or to ops.';
comment on column public.directory_contacts.imported_at is 'Written by every upsert of the import script, so a contact the latest file no longer carries can be found by its older stamp.';

create index directory_contacts_company_id_id_idx on public.directory_contacts (company_id, id);
create index directory_contacts_country_idx on public.directory_contacts (country);
create index directory_contacts_last_first_idx on public.directory_contacts (last_name, first_name);
-- The "title contains" search, trigram backed like the company name.
create index directory_contacts_title_trgm_idx
  on public.directory_contacts using gin (title extensions.gin_trgm_ops);

alter table public.directory_contacts enable row level security;

create policy "directory_contacts: ops read"
  on public.directory_contacts
  for select
  to authenticated
  using ((select private.is_ops()));

create trigger directory_contacts_set_updated_at
  before update on public.directory_contacts
  for each row execute function public.set_updated_at();

revoke insert, update, delete on public.directory_contacts from anon, authenticated;
revoke truncate on public.directory_contacts from anon, authenticated, service_role;

-- The masks (spec 0018, AC-4, Value sourcing). Both live in private so PostgREST never exposes
-- them, and both are called only from inside the definer search function.

-- First character of the local part, then at least three bullets (one fewer than the local part
-- when that is longer), then @ and the full domain. The domain stays readable on purpose: a masked
-- domain shows nothing worth buying (spec 0018, Consequences, an accepted risk).
create or replace function private.mask_email(address text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when address is null or position('@' in address) < 2 then null
    else left(address, 1)
      || repeat('•', greatest(3, length(split_part(address, '@', 1)) - 1))
      || '@'
      || substr(address, position('@' in address) + 1)
  end;
$$;

comment on function private.mask_email(text) is 'First character of the local part, bullets, then @ and the full domain (spec 0018).';

-- The first four and the last two characters kept, every other digit a bullet, every non digit
-- (a space, a plus, a slash) kept as typed so the shape of the number stays readable.
create or replace function private.mask_phone(number text)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  total integer;
  masked text := '';
  position_index integer;
  ch text;
begin
  if number is null then
    return null;
  end if;
  total := length(number);
  for position_index in 1..total loop
    ch := substr(number, position_index, 1);
    if position_index <= 4 or position_index > total - 2 or ch !~ '[0-9]' then
      masked := masked || ch;
    else
      masked := masked || '•';
    end if;
  end loop;
  return masked;
end;
$$;

comment on function private.mask_phone(text) is 'The first four and last two characters kept, every other digit a bullet, non digits kept (spec 0018).';

-- Nothing but the definer functions (which run as their owner) ever calls the masks, so no app
-- role holds execute on them.
revoke execute on function private.mask_email(text) from public;
revoke execute on function private.mask_phone(text) from public;
