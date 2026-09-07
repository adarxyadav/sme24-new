-- Expert profiles (spec 0012, kind E): one row per expert account, created by the invite path
-- before the expert ever signs in, so the ops list is one query and no admin API call.
--
-- Two columns are authorization data the expert can never write: `status` (the sign in gate the
-- expert layout reads) and `photo_path` (the storage object the bucket policies key on). Both move
-- only through the definer functions below; the column grant at the foot of this file leaves them
-- out, along with `email` and the invite stamps, which only ops touch through the service client.
--
-- Every list column is a set of catalogue codes checked with `<@` against the same codes
-- EXPERT_CATALOGUE holds in src/features/experts/catalogue.ts; a Vitest test parses this file and
-- keeps the two equal, so a code added in one place fails the suite until it is added in both.

create table public.expert_profiles (
  expert_id uuid primary key references public.profiles (id) on delete cascade,
  -- Copied at invite so /admin/experts needs no admin API call per row. The sign in address stays
  -- in auth.users; an email change there does not propagate (spec 0012, Follow-up).
  email text not null unique check (email = lower(email)),
  status text not null default 'invited' check (status in ('invited', 'active', 'inactive')),
  headline text null check (char_length(headline) between 1 and 120),
  bio text null check (char_length(bio) between 1 and 800),
  competencies text[] not null default '{}' check (
    competencies <@ array['compliance', 'management_system', 'safety_culture']
  ),
  -- NOGA sections A to U; feature 19 matches these against companies.industry_code by first letter.
  industries text[] not null default '{}' check (
    industries <@ array[
      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K',
      'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U'
    ]
  ),
  standards text[] not null default '{}' check (
    standards <@ array[
      'iso_45001', 'iso_14001', 'iso_9001', 'iso_50001', 'ekas_6508', 'suva_asa', 'arg_argv',
      'vuv', 'stfv', 'scc', 'iso_31000', 'esti', 'bauav', 'psa'
    ]
  ),
  languages text[] not null default '{}' check (languages <@ array['de', 'fr', 'it', 'en']),
  -- The 26 canton codes; matches companies.canton.
  regions text[] not null default '{}' check (
    regions <@ array[
      'AG', 'AI', 'AR', 'BE', 'BL', 'BS', 'FR', 'GE', 'GL', 'GR', 'JU', 'LU', 'NE',
      'NW', 'OW', 'SG', 'SH', 'SO', 'SZ', 'TG', 'TI', 'UR', 'VD', 'VS', 'ZG', 'ZH'
    ]
  ),
  availability text not null default 'available' check (
    availability in ('available', 'limited', 'unavailable')
  ),
  available_from date null,
  availability_note text null check (char_length(availability_note) <= 300),
  years_experience integer null check (years_experience between 0 and 60),
  phone text null check (char_length(phone) <= 30),
  -- Written only by set_expert_photo. The check pins the object to the expert's own folder, so a
  -- row can never point at another expert's photo even if the function were bypassed.
  photo_path text null check (photo_path ~ ('^' || expert_id::text || '/photo\.(jpg|png|webp)$')),
  invited_by uuid null references public.profiles (id) on delete set null,
  invited_at timestamptz not null default now(),
  onboarded_at timestamptz null,
  deactivated_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.expert_profiles is 'One row per expert account (spec 0012). status and photo_path move only through set_expert_status and set_expert_photo.';
comment on column public.expert_profiles.email is 'Copied from the invite so the ops list is one query. Not kept in step with auth.users automatically.';
comment on column public.expert_profiles.status is 'invited → active → inactive. Written only by public.set_expert_status.';
comment on column public.expert_profiles.photo_path is 'Object path in the private expert-photos bucket. Written only by public.set_expert_photo.';

create index expert_profiles_status_idx on public.expert_profiles (status);
create index expert_profiles_invited_at_idx on public.expert_profiles (invited_at desc);
-- Feature 19 (matching) filters on all four lists; GIN is what makes `&&` and `<@` indexable.
create index expert_profiles_competencies_idx on public.expert_profiles using gin (competencies);
create index expert_profiles_industries_idx on public.expert_profiles using gin (industries);
create index expert_profiles_regions_idx on public.expert_profiles using gin (regions);
create index expert_profiles_languages_idx on public.expert_profiles using gin (languages);
create index expert_profiles_invited_by_idx on public.expert_profiles (invited_by);

alter table public.expert_profiles enable row level security;

-- The expert reads their own row whatever the status: the layout gate has to see `inactive` to
-- redirect on it, so this policy carries no status condition.
create policy "expert_profiles: experts read their own row"
  on public.expert_profiles
  for select
  to authenticated
  using (expert_id = (select auth.uid()));

create policy "expert_profiles: experts update their own row"
  on public.expert_profiles
  for update
  to authenticated
  using (expert_id = (select auth.uid()))
  with check (expert_id = (select auth.uid()));

create policy "expert_profiles: ops read all"
  on public.expert_profiles
  for select
  to authenticated
  using ((select private.is_ops()));

create policy "expert_profiles: ops update all"
  on public.expert_profiles
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

create policy "expert_profiles: ops insert"
  on public.expert_profiles
  for insert
  to authenticated
  with check ((select private.is_ops()));

-- A client never reads this table: the summary a client may see comes from
-- assigned_expert_summaries (15_assigned_expert_summaries.sql), which filters on the assignment
-- and exposes only the public half of the profile.

-- Column grants are per role, not per policy, so the expert and ops share one grant: everything
-- the profile form writes, and nothing else. status, photo_path, onboarded_at, deactivated_at,
-- email and the invite stamps stay out; ops change those through the service client after their
-- role check, and the two definer functions own status and photo_path outright.
revoke update on public.expert_profiles from authenticated;
grant update (
  headline,
  bio,
  competencies,
  industries,
  standards,
  languages,
  regions,
  availability,
  available_from,
  availability_note,
  years_experience,
  phone
) on public.expert_profiles to authenticated;

-- The whole status state machine in one place (spec 0012). Ops may run invited → active,
-- invited → inactive, active → inactive, inactive → invited (only before onboarding) and
-- inactive → active (only after it); the expert may run invited → active on their own row, which
-- is what onboarding does. A same state call is a no op that returns the row, so a double submit
-- and a rerun of the idempotent deactivate action are both harmless. Definer because `status`,
-- `onboarded_at` and `deactivated_at` are outside the authenticated update grant; the caller
-- checks in the body are what keep it safe.
create or replace function public.set_expert_status(target uuid, next text)
returns public.expert_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_is_ops boolean := private.is_ops();
  row public.expert_profiles;
begin
  if caller is null then
    raise exception 'not_signed_in';
  end if;

  if next not in ('invited', 'active', 'inactive') then
    raise exception 'invalid_transition';
  end if;

  select * into row from public.expert_profiles e where e.expert_id = target for update;

  if not found then
    raise exception 'not_found';
  end if;

  -- Only ops act on someone else's row; the expert reaches this function through onboarding alone.
  if not caller_is_ops and caller is distinct from target then
    raise exception 'forbidden';
  end if;

  if row.status = next then
    return row;
  end if;

  if caller_is_ops then
    if not (
      (row.status = 'invited' and next in ('active', 'inactive'))
      or (row.status = 'active' and next = 'inactive')
      or (row.status = 'inactive' and next = 'invited' and row.onboarded_at is null)
      or (row.status = 'inactive' and next = 'active' and row.onboarded_at is not null)
    ) then
      raise exception 'invalid_transition';
    end if;
  else
    -- The expert's one move: finishing onboarding on their own row.
    if not (row.status = 'invited' and next = 'active') then
      raise exception 'invalid_transition';
    end if;
  end if;

  update public.expert_profiles e
  set status = next,
      onboarded_at = case
        when next = 'active' then coalesce(e.onboarded_at, now())
        else e.onboarded_at
      end,
      deactivated_at = case when next = 'inactive' then now() else null end
  where e.expert_id = target
  returning * into row;

  return row;
end;
$$;

comment on function public.set_expert_status(uuid, text) is 'The only write path for expert_profiles.status (spec 0012). Enforces the state machine and stamps onboarded_at and deactivated_at.';

revoke execute on function public.set_expert_status(uuid, text) from anon, public;
grant execute on function public.set_expert_status(uuid, text) to authenticated;

-- Writes photo_path on the caller's own row (null clears it). The path prefix check repeats the
-- column check so a wrong path fails with a named error rather than a constraint violation.
-- Definer because photo_path is outside the update grant.
create or replace function public.set_expert_photo(path text)
returns public.expert_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  row public.expert_profiles;
begin
  if caller is null then
    raise exception 'not_signed_in';
  end if;

  if path is not null and path !~ ('^' || caller::text || '/photo\.(jpg|png|webp)$') then
    raise exception 'invalid_path';
  end if;

  update public.expert_profiles e
  set photo_path = path
  where e.expert_id = caller
  returning * into row;

  if not found then
    raise exception 'not_found';
  end if;

  return row;
end;
$$;

comment on function public.set_expert_photo(text) is 'The only write path for expert_profiles.photo_path (spec 0012). Writes the caller''s own row and pins the path to their folder.';

revoke execute on function public.set_expert_photo(text) from anon, public;
grant execute on function public.set_expert_photo(text) to authenticated;

-- The members of an organization an expert is assigned to, with the sign in email. A function
-- rather than a view because the email lives in auth.users, which no app role may read; the
-- caller check is the boundary and raises rather than returning zero rows, so the calling query
-- can tell "not assigned" from "no members".
create or replace function public.assigned_organization_contacts(org uuid)
returns table (user_id uuid, full_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not_signed_in';
  end if;

  if not (private.is_assigned_expert(org) or private.is_ops()) then
    raise exception 'not_assigned';
  end if;

  return query
    select m.user_id, p.full_name, u.email::text, m.role
    from public.organization_members m
    join public.profiles p on p.id = m.user_id
    join auth.users u on u.id = m.user_id
    where m.organization_id = org
    order by m.role, p.full_name;
end;
$$;

comment on function public.assigned_organization_contacts(uuid) is 'Members of an organization for an assigned expert or ops (spec 0012). Raises not_assigned for anyone else.';

revoke execute on function public.assigned_organization_contacts(uuid) from anon, public;
grant execute on function public.assigned_organization_contacts(uuid) to authenticated;

create trigger expert_profiles_set_updated_at
  before update on public.expert_profiles
  for each row execute function public.set_updated_at();

create trigger expert_profiles_audit
  after insert or update or delete on public.expert_profiles
  for each row execute function private.audit_row();

-- No signed out caller ever touches an expert profile: every read and write in this feature is by
-- an authenticated expert or ops. Supabase grants anon the full set at table creation, so it is
-- revoked by hand here and re added by hand in the migration (the diff replays the default).
revoke all on public.expert_profiles from anon;

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.expert_profiles from anon, authenticated, service_role;
