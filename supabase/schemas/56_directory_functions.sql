-- The directory's API (spec 0018). Every function here is `security definer` with an empty
-- search_path, revokes execute from anon and public, grants it to authenticated, and starts with
-- its own role check, because the directory tables carry no select policy for an expert: these
-- functions are the only read path an expert has, and the database, not the app, is what masks
-- or reveals a value (invariant 1). Each raises an SM code the actions branch on
-- (`SM403` forbidden, `SM404` not_found, `SM402` insufficient_credits, `SM429` page_depth), never
-- a message the app has to parse.

-- True for an expert whose expert_profiles row is `active`. Definer so the check does not depend
-- on the caller's own expert_profiles policy; the auth.uid() in the body keeps it safe.
create or replace function private.is_active_expert()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.jwt_app_role() = 'expert'
    and exists (
      select 1 from public.expert_profiles e
      where e.expert_id = (select auth.uid()) and e.status = 'active'
    ),
    false
  );
$$;

revoke execute on function private.is_active_expert() from public;
grant execute on function private.is_active_expert() to authenticated, service_role;

-- Escapes the three LIKE metacharacters so a query of "50%" matches the text "50%".
create or replace function private.like_pattern(needle text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select '%' || replace(replace(replace(needle, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

revoke execute on function private.like_pattern(text) from public;

-- The masked search (AC-4). At most 25 rows ordered by (company name normalised, contact id),
-- keyset paged by the last row's two sort values, with the page ordinal travelling inside the same
-- opaque cursor so one query can walk at most 40 pages (1,000 rows). `q` and `title` are case
-- insensitive "contains" matches backed by the trigram indexes, `country` an exact alpha 2 match;
-- all three optional, so an empty query is the first page of the whole directory.
--
-- The raw email, phone and mobile are non null only when the caller has an unlock row for the
-- contact, or is ops (whose table policy already grants them the row). `unlocked` means "this
-- caller paid", so it stays false for ops.
create or replace function public.directory_search(
  q text default null,
  country text default null,
  title text default null,
  after_name text default null,
  after_id uuid default null,
  after_page integer default null,
  page_size integer default 25
)
returns table (
  contact_id uuid,
  company_id uuid,
  company_name text,
  company_name_normalised text,
  company_country text,
  company_city text,
  first_name text,
  last_name text,
  -- Named contact_* because an OUT column may not share a name with an IN parameter.
  contact_title text,
  contact_country text,
  contact_city text,
  email_masked text,
  phone_masked text,
  mobile_masked text,
  unlocked boolean,
  email text,
  phone text,
  mobile text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_is_ops boolean := private.is_ops();
  size integer := least(greatest(coalesce(page_size, 25), 1), 25);
  query text := nullif(trim(q), '');
  title_query text := nullif(trim(title), '');
begin
  if not (caller_is_ops or private.is_active_expert()) then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  if query is not null and (length(query) < 2 or length(query) > 100) then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  if title_query is not null and (length(title_query) < 2 or length(title_query) > 100) then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  if directory_search.country is not null and directory_search.country !~ '^[A-Z]{2}$' then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  -- A courtesy limit against an accidental deep walk, not a security control: the cursor is not
  -- signed (spec 0018, AC-4).
  if after_page is not null and after_page > 40 then
    raise exception 'page_depth' using errcode = 'SM429';
  end if;

  return query
    select
      c.id,
      co.id,
      co.name,
      co.name_normalised,
      co.country,
      co.city,
      c.first_name,
      c.last_name,
      c.title,
      c.country,
      c.city,
      private.mask_email(c.email),
      private.mask_phone(c.phone),
      private.mask_phone(c.mobile),
      u.id is not null,
      case when caller_is_ops or u.id is not null then c.email end,
      case when caller_is_ops or u.id is not null then c.phone end,
      case when caller_is_ops or u.id is not null then c.mobile end
    from public.directory_contacts c
    join public.directory_companies co on co.id = c.company_id
    left join public.directory_unlocks u
      on u.contact_id = c.id and u.expert_id = caller and not caller_is_ops
    where (query is null or co.name ilike private.like_pattern(query))
      and (title_query is null or c.title ilike private.like_pattern(title_query))
      and (directory_search.country is null or c.country = directory_search.country)
      and (after_name is null or after_id is null or (co.name_normalised, c.id) > (after_name, after_id))
    order by co.name_normalised, c.id
    limit size;
end;
$$;

comment on function public.directory_search(text, text, text, text, uuid, integer, integer) is
  'The masked directory search (spec 0018, AC-4): 25 rows per page, keyset paged, raw values only for an unlocked row or ops. Active experts and ops only (SM403); SM429 past page 40.';

-- The distinct country codes present in the directory with a contact count, for the search
-- form's select. Same callers as the search.
create or replace function public.directory_countries()
returns table (country text, contacts bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (private.is_ops() or private.is_active_expert()) then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    select c.country, count(*)
    from public.directory_contacts c
    where c.country is not null
    group by c.country
    order by c.country;
end;
$$;

comment on function public.directory_countries() is 'The alpha 2 codes present in the directory with a contact count each (spec 0018, AC-5). Active experts and ops only.';

-- Supabase's default privileges grant execute to anon on every new public function and the
-- declarative diff never emits the revoke, so the migration repeats these lines by hand
-- (AGENTS.md).
revoke execute on function public.directory_search(text, text, text, text, uuid, integer, integer) from anon, public;
grant execute on function public.directory_search(text, text, text, text, uuid, integer, integer) to authenticated;
revoke execute on function public.directory_countries() from anon, public;
grant execute on function public.directory_countries() to authenticated;

-- The caller's credit balance (AC-5, invariant 2): sum(delta) over their ledger rows, never a
-- stored figure. An expert reads their own; ops may pass an expert_id to read anyone's. The rows
-- are readable under RLS anyway, so this is a convenience the page header and the reveal share,
-- not a boundary; it stays definer so the ops overload can read another expert's rows.
create or replace function public.directory_credit_balance(expert_id uuid default null)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  subject uuid;
begin
  if private.is_ops() then
    subject := coalesce(directory_credit_balance.expert_id, caller);
  elsif private.is_active_expert() then
    if directory_credit_balance.expert_id is not null and directory_credit_balance.expert_id <> caller then
      raise exception 'forbidden' using errcode = 'SM403';
    end if;
    subject := caller;
  else
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return (
    select coalesce(sum(e.delta), 0)::integer
    from public.directory_credit_entries e
    where e.expert_id = subject
  );
end;
$$;

comment on function public.directory_credit_balance(uuid) is 'sum(delta) over an expert''s credit ledger (spec 0018). An expert reads their own; ops may name an expert_id.';

revoke execute on function public.directory_credit_balance(uuid) from anon, public;
grant execute on function public.directory_credit_balance(uuid) to authenticated;
