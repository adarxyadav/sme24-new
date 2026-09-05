-- Profiles: one row per auth user with the app role and (feature 3) the current organization.
-- Spec 0001 security model: RLS on from the first migration, authorization claims in
-- app_metadata, the custom access token hook reads the role from here.
-- Spec 0002 (kind U): full_name and locale are display data the user may edit; role and
-- organization_id are authorization data the user can never change (column grants below).

create type public.app_role as enum ('client', 'expert', 'ops');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'client',
  organization_id uuid,
  full_name text null,
  locale text not null default 'de' check (locale in ('de', 'en')),
  -- Spec 0005 (AC-11): when the user accepted the terms. Written once, by handle_new_user from
  -- the sign up metadata or by accept_terms() for provider sign ups; never by a direct update
  -- (the column grant below leaves it out).
  terms_accepted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'App profile per auth user: role, current organization, display name and locale.';
comment on column public.profiles.organization_id is 'The user''s current organization, kept in step with organization_members by a trigger (foreign key declared in 10_organizations.sql).';
comment on column public.profiles.terms_accepted_at is 'When the user accepted the terms (spec 0005). Set once by handle_new_user or accept_terms(); not writable through the API.';

alter table public.profiles enable row level security;

create policy "profiles: users read their own row"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

-- Members see the profiles of the people in their organization (team page, "requested by").
create policy "profiles: members read their organization"
  on public.profiles
  for select
  to authenticated
  using (organization_id = (select private.jwt_org_id()));

-- Users edit their own display data. The column grant below limits this to full_name and locale.
create policy "profiles: users update their own row"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "profiles: ops read all"
  on public.profiles
  for select
  to authenticated
  using ((select private.is_ops()));

create policy "profiles: ops update all"
  on public.profiles
  for update
  to authenticated
  using ((select private.is_ops()))
  with check ((select private.is_ops()));

-- A user can never change their own role or organization: only these two columns are writable
-- through the API. Role and organization changes go through the service client (ops actions)
-- or the membership trigger.
revoke update on public.profiles from authenticated;
grant update (full_name, locale) on public.profiles to authenticated;

-- The auth admin role (used by the access token hook) may read roles.
grant usage on schema public to supabase_auth_admin;
grant select on table public.profiles to supabase_auth_admin;

create policy "profiles: auth admin reads for the token hook"
  on public.profiles
  as permissive
  for select
  to supabase_auth_admin
  using (true);

-- Keep updated_at honest.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create the profile when a user is created. The role comes from app_metadata (set by ops, the
-- invite script or the seed), defaulting to client. full_name and locale come from user metadata
-- when present (display data only, never authorization); an unknown locale falls back to de.
-- Spec 0005: full_name also accepts the `name` key a provider (Google, Microsoft) sends, and
-- terms_accepted_at is copied when the sign up metadata carries a value that parses as a
-- timestamp (the sign up form writes it only when the consent box was ticked).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_role text := new.raw_app_meta_data ->> 'role';
  requested_locale text := new.raw_user_meta_data ->> 'locale';
  consent timestamptz;
begin
  begin
    consent := (new.raw_user_meta_data ->> 'terms_accepted_at')::timestamptz;
  exception when others then
    consent := null;
  end;

  insert into public.profiles (id, role, full_name, locale, terms_accepted_at)
  values (
    new.id,
    case
      when requested_role in ('client', 'expert', 'ops') then requested_role::public.app_role
      else 'client'::public.app_role
    end,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', '')
    ),
    case when requested_locale in ('de', 'en') then requested_locale else 'de' end,
    consent
  );
  return new;
end;
$$;

-- Records the caller's consent (spec 0005, AC-11): the only write path for terms_accepted_at
-- besides handle_new_user. Writes now() only when the column is still null and returns the
-- stored value either way, so a double submit is harmless and the result is never null for a
-- signed in caller. Definer because the column is outside the authenticated update grant; the
-- auth.uid() check is what keeps it safe. Runs as the signed in user (PostgREST rpc).
create or replace function public.accept_terms()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  accepted_at timestamptz;
begin
  if caller is null then
    raise exception 'not_signed_in';
  end if;

  update public.profiles
  set terms_accepted_at = now()
  where id = caller and terms_accepted_at is null;

  select p.terms_accepted_at into accepted_at
  from public.profiles p
  where p.id = caller;

  if accepted_at is null then
    raise exception 'no_profile';
  end if;

  return accepted_at;
end;
$$;

comment on function public.accept_terms() is 'Records the caller''s consent once and returns when it was given. The only API write path for profiles.terms_accepted_at.';

revoke execute on function public.accept_terms() from anon, public;
grant execute on function public.accept_terms() to authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function private.audit_row();

-- TRUNCATE walks around RLS and fires no row trigger, so it would wipe every tenant at once
-- and leave nothing in the audit log. Supabase's default privileges hand it to all three app
-- roles at creation, so every table revokes it explicitly.
revoke truncate on public.profiles from anon, authenticated, service_role;
