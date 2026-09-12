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

-- The paid reveal (AC-11, invariants 2 and 3). One transaction under an advisory lock keyed on
-- the caller: refuses a caller who is not an active expert (SM403), a missing or suppressed
-- contact (SM404), returns the full row without a debit when the caller already unlocked it,
-- otherwise refuses a balance below one (SM402), else inserts the unlock and the -1 ledger row
-- and returns the full row with the new balance. It is the only write path into
-- directory_unlocks and the only debit path into directory_credit_entries.
create or replace function public.directory_reveal(contact_id uuid)
returns table (
  id uuid,
  company_id uuid,
  company_name text,
  company_country text,
  company_city text,
  first_name text,
  last_name text,
  contact_title text,
  contact_country text,
  contact_city text,
  email text,
  phone text,
  mobile text,
  unlocked_at timestamptz,
  balance integer,
  already_unlocked boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  the_contact public.directory_contacts;
  the_unlock public.directory_unlocks;
  balance_now integer;
  was_unlocked boolean := false;
begin
  if not private.is_active_expert() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;

  -- Two reveals from one expert at once would both read the same balance; the lock serialises
  -- them, so a balance of one pays for exactly one unlock.
  perform pg_advisory_xact_lock(hashtextextended(caller::text, 0));

  select c.* into the_contact from public.directory_contacts c where c.id = directory_reveal.contact_id;
  if not found or exists (
    select 1 from public.directory_suppressions s
    where s.email_hash = encode(sha256(convert_to(lower(the_contact.email), 'UTF8')), 'hex')
  ) then
    raise exception 'not_found' using errcode = 'SM404';
  end if;

  select u.* into the_unlock
  from public.directory_unlocks u
  where u.expert_id = caller and u.contact_id = the_contact.id;
  if found then
    was_unlocked := true;
  else
    select coalesce(sum(e.delta), 0)::integer into balance_now
    from public.directory_credit_entries e
    where e.expert_id = caller;
    if balance_now < 1 then
      raise exception 'insufficient_credits' using errcode = 'SM402';
    end if;
    insert into public.directory_unlocks (expert_id, contact_id)
    values (caller, the_contact.id)
    returning * into the_unlock;
    insert into public.directory_credit_entries (expert_id, delta, reason, unlock_id)
    values (caller, -1, 'unlock', the_unlock.id);
  end if;

  select coalesce(sum(e.delta), 0)::integer into balance_now
  from public.directory_credit_entries e
  where e.expert_id = caller;

  return query
    select
      the_contact.id,
      co.id,
      co.name,
      co.country,
      co.city,
      the_contact.first_name,
      the_contact.last_name,
      the_contact.title,
      the_contact.country,
      the_contact.city,
      the_contact.email,
      the_contact.phone,
      the_contact.mobile,
      the_unlock.created_at,
      balance_now,
      was_unlocked
    from public.directory_companies co
    where co.id = the_contact.company_id;
end;
$$;

comment on function public.directory_reveal(uuid) is
  'Reveals one contact for one credit (spec 0018, AC-11): checks, debits and returns the row in one transaction under a per caller lock. Active experts only; SM402 below one credit, SM404 for a missing contact.';

-- The caller's unlocked contacts, newest first, keyset paged (AC-13): the same masking free
-- shape as a revealed row. page_size clamps at 500 for the CSV export.
create or replace function public.directory_unlocked_contacts(
  after_created_at timestamptz default null,
  after_id uuid default null,
  page_size integer default 25
)
returns table (
  unlock_id uuid,
  id uuid,
  company_id uuid,
  company_name text,
  company_country text,
  company_city text,
  first_name text,
  last_name text,
  contact_title text,
  contact_country text,
  contact_city text,
  email text,
  phone text,
  mobile text,
  unlocked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  size integer := least(greatest(coalesce(page_size, 25), 1), 500);
begin
  if not private.is_active_expert() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    select
      u.id,
      c.id,
      co.id,
      co.name,
      co.country,
      co.city,
      c.first_name,
      c.last_name,
      c.title,
      c.country,
      c.city,
      c.email,
      c.phone,
      c.mobile,
      u.created_at
    from public.directory_unlocks u
    join public.directory_contacts c on c.id = u.contact_id
    join public.directory_companies co on co.id = c.company_id
    where u.expert_id = caller
      and (after_created_at is null or after_id is null
           or (u.created_at, u.id) < (after_created_at, after_id))
    order by u.created_at desc, u.id desc
    limit size;
end;
$$;

comment on function public.directory_unlocked_contacts(timestamptz, uuid, integer) is
  'The caller''s unlocked contacts newest first, keyset paged, up to 500 a page (spec 0018, AC-13). Active experts only.';

-- What ops see on /admin/directory (AC-15): one row per expert with a balance or an unlock.
create or replace function public.directory_ops_summary()
returns table (
  expert_id uuid,
  full_name text,
  email text,
  balance integer,
  credits_bought integer,
  unlocks bigint,
  last_unlock_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_ops() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  return query
    with ledger as (
      select e.expert_id,
             coalesce(sum(e.delta), 0)::integer as balance,
             coalesce(sum(e.delta) filter (where e.reason = 'purchase'), 0)::integer as credits_bought
      from public.directory_credit_entries e
      group by e.expert_id
    ),
    unlocked as (
      select u.expert_id, count(*) as unlocks, max(u.created_at) as last_unlock_at
      from public.directory_unlocks u
      group by u.expert_id
    )
    select
      p.id,
      p.full_name,
      x.email,
      coalesce(l.balance, 0),
      coalesce(l.credits_bought, 0),
      coalesce(k.unlocks, 0),
      k.last_unlock_at
    from public.profiles p
    join public.expert_profiles x on x.expert_id = p.id
    left join ledger l on l.expert_id = p.id
    left join unlocked k on k.expert_id = p.id
    where l.expert_id is not null or k.expert_id is not null
    order by k.last_unlock_at desc nulls last, p.full_name;
end;
$$;

comment on function public.directory_ops_summary() is
  'One row per expert with a balance or an unlock: balance, credits bought, unlocks, last unlock (spec 0018, AC-15). Ops only.';

-- An objection (AC-15, invariant 8): deletes the contact (cascading their unlocks and setting the
-- ledger rows'' unlock_id null) and inserts the email hash into directory_suppressions in one
-- transaction. A not found email is still suppressed, so an objection lands before the next
-- import. Answers whether a row was removed and how many unlocks it took with it, so ops see what
-- the removal cost the buyers (no refund and no notice in this slice, owner decision 2026-09-12).
create or replace function public.directory_remove_contact(email text, reason text)
returns table (removed boolean, unlocks_cascaded integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  normalised text := lower(trim(directory_remove_contact.email));
  the_hash text;
  the_contact_id uuid;
  cascaded integer := 0;
begin
  if not private.is_ops() then
    raise exception 'forbidden' using errcode = 'SM403';
  end if;
  if directory_remove_contact.reason not in ('data_subject_request', 'bounce', 'ops') then
    raise exception 'validation' using errcode = 'SM400';
  end if;
  the_hash := encode(sha256(convert_to(normalised, 'UTF8')), 'hex');

  insert into public.directory_suppressions (email_hash, reason, created_by)
  values (the_hash, directory_remove_contact.reason, caller)
  on conflict (email_hash) do nothing;

  select c.id into the_contact_id from public.directory_contacts c where c.email = normalised;
  if the_contact_id is null then
    return query select false, 0;
    return;
  end if;
  select count(*)::integer into cascaded from public.directory_unlocks u where u.contact_id = the_contact_id;
  delete from public.directory_contacts c where c.id = the_contact_id;
  return query select true, cascaded;
end;
$$;

comment on function public.directory_remove_contact(text, text) is
  'Removes a person from the directory and suppresses their email hash in one transaction (spec 0018, AC-15). Ops only; answers removed and the unlocks cascaded.';

revoke execute on function public.directory_reveal(uuid) from anon, public;
grant execute on function public.directory_reveal(uuid) to authenticated;
revoke execute on function public.directory_unlocked_contacts(timestamptz, uuid, integer) from anon, public;
grant execute on function public.directory_unlocked_contacts(timestamptz, uuid, integer) to authenticated;
revoke execute on function public.directory_ops_summary() from anon, public;
grant execute on function public.directory_ops_summary() to authenticated;
revoke execute on function public.directory_remove_contact(text, text) from anon, public;
grant execute on function public.directory_remove_contact(text, text) to authenticated;
